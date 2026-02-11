# Building Runbook

## Purpose

Build standalone desktop release binaries (no installer artifacts).

## Prerequisites

- Node.js 22
- npm
- Rust toolchain
- Platform-native Tauri dependencies (for Linux: WebKitGTK and GTK dev packages)

## Local Build

```bash
cd /Users/bunni/workspace/csv-dashboard
npm install
npm run tauri:build
```

## Output Paths

With current config (`src-tauri/tauri.conf.json` has `bundle.active: false`), primary outputs are:

- macOS/Linux: `src-tauri/target/release/csv-dashboard`
- Windows: `src-tauri/target/release/csv-dashboard.exe`

## Notes

- `npm run tauri:dev` is for local development, not release binaries.
- Multi-platform release binaries are produced by GitHub Actions in `.github/workflows/release-binaries.yml`.
