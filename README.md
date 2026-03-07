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

The Electron shell exposes a secure voice self-test that performs an authenticated
handshake, derives fresh session keys, and validates encrypted UDP voice transport.

## Repo layout

- electron/ - Electron main and preload processes
- src/ - Renderer app (React + Radix UI)
- legacy/ - Previous native implementation (reference only, no build system)

## Notes

- Legacy documentation and native build instructions have been removed for now.
- If you need the old code, look under legacy/ and treat it as read-only reference.
