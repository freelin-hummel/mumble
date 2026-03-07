# Mumble Electron Client

This repository now targets a single Electron-based client that can run as a desktop or web shell.
The previous native Qt implementation is preserved in legacy/ for reference only.

## Goals

- Electron + Vite + React + TypeScript foundation
- Radix UI components with small, reusable UI primitives
- Clear separation between main, preload, and renderer code

## Quick start

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## Packaging

This project uses **electron-builder** for packaging because it fits the current Electron + Vite + React split with minimal extra setup and can emit native artifacts for macOS, Windows, and Linux from the same build output.

### Packaging scripts

```bash
npm run pack          # unpacked app for the current platform
npm run package       # installable artifact for the current platform
npm run package:mac   # macOS dmg + zip
npm run package:win   # Windows NSIS installer
npm run package:linux # Linux AppImage + deb
```

`npm run build` still performs the production renderer + main/preload build, writing the renderer bundle to `dist/renderer` and the Electron entrypoints to `dist/electron`. Packaging then consumes those built files and writes artifacts to `release/`.

### Packaging configuration

- Config file: `electron-builder.config.mjs`
- App metadata: `appId`, product name, and artifact naming live in the builder config
- Icons: existing assets under `legacy/icons/` are reused for `.icns`, `.ico`, and Linux packaging
- Artifact naming: `${productName}-${version}-${os}-${arch}.${ext}`

### Optional signing placeholders

Packaging works unsigned by default. To enable signing in local builds or CI, provide the standard `electron-builder` environment variables before running the package command:

- macOS identity: `CSC_NAME`
- macOS certificate: `CSC_LINK`, `CSC_KEY_PASSWORD`
- Windows certificate: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, optional `WIN_CSC_SUBJECT_NAME`
- Linux artifacts: AppImage and DEB targets are enabled by default in the packaging config

### CI packaging step

`.github/workflows/electron-package.yml` runs `npm test` and then packages the app on `ubuntu-latest`, `macos-latest`, and `windows-latest`, uploading the generated `release/` artifacts without publishing them.

The Electron shell exposes a secure voice self-test that performs an authenticated
handshake, derives fresh session keys, and validates encrypted UDP voice transport.

## Repo layout

- electron/ - Electron main and preload processes
- src/ - Renderer app (React + Radix UI)
- legacy/ - Previous native implementation (reference only, no build system)

## Notes

- Follow-up tracks after this milestone: real Mumble protocol/session sync, native tray/menu/window integrations, and live audio metering plus transport telemetry.
- Legacy documentation and native build instructions have been removed for now.
- If you need the old code, look under legacy/ and treat it as read-only reference.
