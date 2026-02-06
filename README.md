# Local CSV Explorer

A dependency-free web app for local CSV exploration and visualization.

## Repo structure

```text
/Users/bunni/workspace/csv-dasboard
  README.md
  .gitignore
  web/
    index.html
    style.css
    app.js
```

## Features

- Drag/drop CSV ingest (or file picker)
- Spreadsheet-style data view with inferred column types
- 2D chart tab
  - Y-series checkbox selection
  - X axis from row index or numeric column
  - Line, scatter, or line+scatter modes
- 3D chart tab
  - Select numeric `x`, `y`, `z`
  - Optional color and size columns
  - Drag to rotate, scroll to zoom
- Fully local execution: no backend, no data upload

## Run locally

From `/Users/bunni/workspace/csv-dasboard`:

```bash
python3 -m http.server 8080 --directory web
```

Then open [http://localhost:8080](http://localhost:8080).

You can also open `/Users/bunni/workspace/csv-dasboard/web/index.html` directly in a browser, but using a local server is recommended.

## Notes

- CSV parsing includes support for quoted fields and escaped quotes (`""`).
- Delimiter auto-detection supports comma, semicolon, tab, and pipe.
- The table view currently renders up to the first 2,000 rows for performance.
