# Mumble web client bootstrap

This directory contains an optional, navigable bootstrap for a future Mumble web client.
It mirrors the existing desktop UI surface area with stubbed screens so flows can be
reviewed in a browser or packaged with Electron while backend functionality is still
being implemented.

## Goals

- Provide a sleek, minimal single-page web client shell
- Preserve UI parity with the existing Qt forms in `src/mumble/**/*.ui`
- Keep implementations intentionally stubbed while flows and navigation are designed
- Reuse the same shell for Electron packaging

## Scripts

```bash
npm ci
npm test
npm run build:web
npm run start
npm run start:electron
npm run build:electron
```

`npm run build:electron` produces an unpacked Electron build with `electron-builder`.
