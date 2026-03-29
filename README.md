# Is My Website SEO Poisoned?

A small Node.js tool that compares how a URL responds to:

- a normal direct visit
- a Google search click
- Googlebot

Because of the widespread gambling ads appearing on Bangladeshi government websites, I conducted an analysis on the issue and found patterns consistent with SEO poisoning and cloaking behavior. That led me to turn the investigation workflow into a simple tool that others can use:

[Analysis: Casino/Gambling Ad Malware Affecting Bangladeshi Government Websites](https://www.linkedin.com/pulse/analysis-casinogambling-ad-malware-affecting-bangladeshi-saad-2l7jc/)

## What it does

The app requests the same URL in three different ways and helps you compare the returned content side by side. It is useful for spotting possible cloaking, poisoned SEO pages, suspicious redirects, or crawler-only content.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Scripts

```bash
npm run build:css
npm run build
npm start
```

## Build output

```bash
npm run build
```

This creates a `dist/` folder for deployment.

## Notes

- This is an investigation tool, not proof of compromise.
- Some websites behave differently because of bot protection, geolocation, login state, or rate limits.
- A different response across the three views is a signal to investigate further.
