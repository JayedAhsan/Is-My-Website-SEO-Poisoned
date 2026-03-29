const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of ["index.html", "styles.css", "server.js", "package.json"]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

console.log("Built dist/");
