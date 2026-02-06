# Local CSV Explorer

A local-first CSV exploration app with two runtime modes:

- Browser mode: static web app served from `app-web/`
- Desktop mode: Tauri shell in `src-tauri/` that loads the same frontend

## Repo structure

```text
/Users/bunni/workspace/csv-dasboard
  app-web/
    app.js
    index.html
    lib/
    style.css
    vendor/
  configs/
    examples/
  src-tauri/
    src/main.rs
    capabilities/default.json
    tauri.conf.json
  tests/
    e2e/app.spec.js
    fixtures/
    unit/
  scripts/prepare-app-web-assets.mjs
  package.json
  playwright.config.js
  vitest.config.js
```

## Features

- Drag/drop CSV ingest (or file picker)
- Spreadsheet-style data view with inferred column types
- Grid data operations
  - Per-column filters with comma-separated compound rules
    - Strings: `b1,b2` means `b1 OR b2`
    - Numerics: `>1,<3` means `>1 AND <3`
  - Column sort (ascending/descending)
  - Quick stats panel on filtered rows
- Plotly-powered 2D plot tab with selectable series and style
- Plotly-powered 3D plot tab with axis, color, and size selectors
- Plot workflow is additive:
  - Data tab filters/sort define the base row set
  - 2D/3D tabs can apply additional plot-only subfilters on top
- Export button writes the current active view to CSV
  - Data tab: filtered + sorted rows
  - 2D/3D tabs: data-filtered rows plus plot subfilter
- YAML preset workflow for reuse across CSVs
  - Save current filter/sort/plot settings as a human-readable `.yaml` preset
  - Load presets from a user-selected directory using the `Load presets` button
  - Presets map settings by column name (not index) for cross-file reuse
- Fully local runtime: no backend and no data upload

## Browser mode

From `/Users/bunni/workspace/csv-dasboard`:

```bash
npm install
npm run serve
```

Open [http://localhost:8080](http://localhost:8080).

Preset workflow:

- Click `Load presets` and choose a directory containing `.yaml` / `.yml` files
- Select a preset from the dropdown and click `Apply preset`
- `Save preset YAML` downloads your current settings as a reusable file
- Example presets live under `configs/examples/` in this repo

## Desktop mode (Tauri)

From `/Users/bunni/workspace/csv-dasboard`:

```bash
npm install
npm run tauri:dev
```

This launches a local desktop window using the same frontend in `app-web/`.

## Standalone release binaries (GitHub Actions)

Standalone binaries (no installers) are built by:

- `/Users/bunni/workspace/csv-dasboard/.github/workflows/release-binaries.yml`

Platforms:

- Windows x86_64
- macOS arm64

How to trigger:

- Tag push (recommended): push a tag like `v0.1.0`
- Manual: run the workflow from the Actions tab (`workflow_dispatch`)

On tag pushes, the workflow also creates/updates a GitHub Release and attaches:

- `csv-dashboard-windows-x86_64.exe`
- `csv-dashboard-macos-arm64.app.zip`

## Regression testing

Install dependencies:

```bash
npm install
npx playwright install --with-deps chromium
```

`npm install` also provisions the local Plotly bundle at `app-web/vendor/plotly.min.js`, so charting works offline after install.

Run all tests:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run unit tests with coverage thresholds:

```bash
npm run test:coverage
```

Run only e2e tests:

```bash
npm run test:e2e
```

## Notes

- CSV parsing supports quoted fields and escaped quotes (`""`).
- Delimiter auto-detection supports comma, semicolon, tab, and pipe.
- The table view renders up to the first 2,000 rows for performance.
