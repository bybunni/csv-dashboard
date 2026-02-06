# Local Web App Runbook

## Purpose

Run the browser-only local CSV explorer without using Tauri.

## Prerequisites

- Node.js 22
- npm

## Start the App

```bash
cd /Users/bunni/workspace/csv-dasboard
npm install
npm run serve
```

Open:

- <http://localhost:8080>

## Usage Notes

- Drag/drop a CSV or use Browse.
- Presets are loaded from a user-selected directory via `Load presets`.
- `Save preset YAML` downloads the current settings as a reusable YAML file.

## Stop the App

- Press `Ctrl+C` in the terminal running `npm run serve`.

