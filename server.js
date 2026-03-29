const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const INDEX_PATH = path.join(__dirname, "index.html");
const STYLES_PATH = path.join(__dirname, "styles.css");
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1024 * 1024;
const TLS_FALLBACK_ERRORS = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED"
]);

const REQUEST_PROFILES = {
  direct: {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  },
  search: {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      referer: "https://google.com/",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  },
  bot: {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function serveIndex(response) {
  fs.readFile(INDEX_PATH, "utf8", (error, contents) => {
    if (error) {
      sendJson(response, 500, { error: "Failed to load index.html" });
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(contents);
  });
}

function serveStyles(response) {
  fs.readFile(STYLES_PATH, "utf8", (error, contents) => {
    if (error) {
      sendJson(response, 500, { error: "Failed to load styles.css. Run npm run build:css first." });
      return;
    }

    response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    response.end(contents);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 50_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function clipBody(body) {
  if (body.length <= MAX_BODY_BYTES) {
    return body;
  }

  return `${body.slice(0, MAX_BODY_BYTES)}\n\n[output truncated after ${MAX_BODY_BYTES} bytes]`;
}

function shouldRetryInsecure(error) {
  return Boolean(error && TLS_FALLBACK_ERRORS.has(error.code));
}

function fetchUrl(targetUrl, profile, redirectCount = 0, allowInsecure = false) {
  return new Promise((resolve) => {
    const urlObject = new URL(targetUrl);
    const transport = urlObject.protocol === "https:" ? https : http;

    const requestOptions = {
      method: "GET",
      headers: profile.headers,
      timeout: 15000
    };

    if (urlObject.protocol === "https:" && allowInsecure) {
      requestOptions.rejectUnauthorized = false;
    }

    const request = transport.request(urlObject, requestOptions, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (location && status >= 300 && status < 400 && redirectCount < MAX_REDIRECTS) {
        const redirectedUrl = new URL(location, urlObject).toString();
        response.resume();
        resolve(fetchUrl(redirectedUrl, profile, redirectCount + 1, allowInsecure));
        return;
      }

      const chunks = [];
      let totalLength = 0;

      response.on("data", (chunk) => {
        totalLength += chunk.length;

        if (totalLength <= MAX_BODY_BYTES) {
          chunks.push(chunk);
        }
      });

      response.on("end", () => {
        const body = clipBody(Buffer.concat(chunks).toString("utf8"));
        resolve({
          ok: true,
          status,
          finalUrl: urlObject.toString(),
          contentType: response.headers["content-type"] || "",
          body,
          insecureTls: allowInsecure
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Timed out while contacting the target site"));
    });

    request.on("error", (error) => {
      if (urlObject.protocol === "https:" && !allowInsecure && shouldRetryInsecure(error)) {
        resolve(fetchUrl(targetUrl, profile, redirectCount, true));
        return;
      }

      resolve({
        ok: false,
        statusText: "Request failed",
        error: error.message
      });
    });

    request.end();
  });
}

async function handleCheck(request, response) {
  try {
    const body = await readJsonBody(request);
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";

    if (!rawUrl) {
      sendJson(response, 400, { error: "Missing url" });
      return;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      sendJson(response, 400, { error: "Invalid URL" });
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      sendJson(response, 400, { error: "Only http and https URLs are supported" });
      return;
    }

    const [direct, search, bot] = await Promise.all([
      fetchUrl(parsed.toString(), REQUEST_PROFILES.direct),
      fetchUrl(parsed.toString(), REQUEST_PROFILES.search),
      fetchUrl(parsed.toString(), REQUEST_PROFILES.bot)
    ]);

    sendJson(response, 200, { direct, search, bot });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  }
}

const server = http.createServer((request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  const incomingUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && incomingUrl.pathname === "/") {
    serveIndex(response);
    return;
  }

  if (request.method === "GET" && incomingUrl.pathname === "/styles.css") {
    serveStyles(response);
    return;
  }

  if (request.method === "POST" && incomingUrl.pathname === "/api/check") {
    handleCheck(request, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`SEO poison checker running at http://localhost:${PORT}`);
});
