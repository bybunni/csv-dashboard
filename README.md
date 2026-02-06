# Local CSV Explorer

A local-first web app for CSV exploration and visualization.

## Repo structure

```text
/Users/bunni/workspace/csv-dasboard
  .github/workflows/test.yml
  tests/
    e2e/app.spec.js
    fixtures/
    unit/csv-core.test.js
  web/
    app.js
    index.html
    lib/csv-core.js
    style.css
  package.json
  playwright.config.js
  vitest.config.js
```

## Features

- Drag/drop CSV ingest (or file picker)
- Spreadsheet-style data view with inferred column types
- 2D plot tab with selectable series and style
- 3D plot tab with axis, color, and size selectors
- Fully local runtime: no backend and no data upload

## Run locally

From `/Users/bunni/workspace/csv-dasboard`:

```bash
python3 -m http.server 8080 --directory web
```

Then open [http://localhost:8080](http://localhost:8080).

## Regression testing

Install dev dependencies:

```bash
npm install
npx playwright install --with-deps chromium
```

Run all tests:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run only e2e tests:

```bash
npm run test:e2e
```

## Notes

- CSV parsing supports quoted fields and escaped quotes (`""`).
- Delimiter auto-detection supports comma, semicolon, tab, and pipe.
- The table view renders up to the first 2,000 rows for performance.
