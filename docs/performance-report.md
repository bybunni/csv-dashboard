# Performance Report

Date: 2026-02-10  
Project: `csv-dashboard`  
Scope: performance behavior for large CSV workloads (10,000+ rows, 100+ columns)

## Executive Summary

The current architecture is functionally correct but fundamentally expensive at large scales. The main bottleneck is not a single bug; it is the interaction of:

- full recompute + full redraw on nearly every input event,
- non-virtualized table rendering with large DOM replacement,
- redraw of hidden plots/tabs,
- repeated filter parsing/evaluation work in hot loops.

The app is not misconfigured in one place; it is mostly an architectural scaling limit. A table virtualization layer is the most important structural upgrade.

## Findings

1. Full redraw pipeline is triggered too often
- `renderViews()` rebuilds the base view and redraws table, stats, 2D, and 3D on each call.
- References: `app-web/app.js:1439`, `app-web/app.js:1442`, `app-web/app.js:1443`, `app-web/app.js:1444`, `app-web/app.js:1445`
- Many inputs call it directly on each change/keystroke.
- References: `app-web/app.js:314`, `app-web/app.js:323`, `app-web/app.js:338`, `app-web/app.js:343`, `app-web/app.js:348`, `app-web/app.js:356`, `app-web/app.js:366`, `app-web/app.js:379`

2. Hidden tab plots are still redrawn
- Even if the active tab is Data, all 2D and 3D plots are iterated and redrawn in `renderViews()`.
- References: `app-web/app.js:1444`, `app-web/app.js:1445`, `app-web/app.js:1597`, `app-web/app.js:1728`

3. Table rendering architecture does not scale
- Table is rebuilt as one large HTML string and assigned via `innerHTML` each render.
- References: `app-web/app.js:1497`, `app-web/app.js:1510`
- Row cap is 2000, but at 100+ columns this still creates hundreds of thousands of cells per redraw.
- Reference: `app-web/app.js:13`
- CSS choices increase layout/paint complexity at scale.
- References: `app-web/style.css:237`, `app-web/style.css:238`, `app-web/style.css:240`, `app-web/style.css:245`, `app-web/style.css:282`

4. Filter path does unnecessary per-row/per-column work
- Filtering loops all columns for each row even when only a few filters are active.
- References: `app-web/lib/data-ops.js:55`, `app-web/lib/data-ops.js:56`, `app-web/lib/data-ops.js:57`
- Numeric filter parsing happens inside hot cell matching logic.
- References: `app-web/lib/data-ops.js:81`, `app-web/lib/data-ops.js:83`

5. Plot rendering mode is expensive for high point counts
- 2D uses Plotly `scatter` (SVG path) for all workloads.
- Reference: `app-web/app.js:1673`
- Frequent `Plotly.react` on control changes compounds cost.
- References: `app-web/app.js:1694`, `app-web/app.js:1860`

6. Main-thread data processing blocks UI
- CSV parsing and normalization happen on the UI thread after `file.text()`.
- References: `app-web/app.js:521`, `app-web/app.js:522`, `app-web/lib/csv-core.js:3`

## Benchmark Evidence (Local)

Test fixtures used:
- `tests/data/stress_single_header_5000_rows_300_cols.csv`
- `tests/data/stress_single_header_25000_rows_300_cols.csv`

Method:
- Node-based micro-benchmarks for parse/filter/sort/stats and table HTML string generation.
- These numbers do not include full browser layout/paint costs, so real UI redraw cost is higher.

### Data Ops Timing

`5000 x 300`:
- `parseCsv`: 91.671 ms
- `normalizeRows`: 1.373 ms
- `inferColumnTypes`: 39.996 ms
- `buildViewRows` (no filters): 6.727 ms

`25000 x 300`:
- `parseCsv`: 490.063 ms
- `normalizeRows`: 22.132 ms
- `inferColumnTypes`: 43.402 ms
- `buildViewRows` (no filters): 35.301 ms
- `buildViewRows` (one numeric filter): 34.254 ms
- `buildViewRows` (filter + sort): 26.867 ms

### Table HTML Generation Timing (String only)

At `MAX_TABLE_ROWS=2000`:
- `2000 x 100`: 35.268 ms, output ~5.67 MB HTML
- `2000 x 300`: 79.334 ms, output ~16.94 MB HTML

### Filter Loop Optimization Micro-benchmark

Baseline (`buildViewRows`) vs active-filter-only scan on `25000 x 300`:
- no-sort loop (20 runs): `403.174 ms` vs `216.980 ms`
- sort loop (20 runs): `372.105 ms` vs `151.282 ms`

Interpretation:
- filtering path has clear headroom, but DOM/render remains the dominant user-perceived bottleneck.

## Recommendations

## Set 1: Immediate Stabilization (Low risk, 1-3 days)

Goal: improve responsiveness without major architecture changes.

- Redraw only the active tab in `renderViews()`.
- Active Data tab target: table + stats only.
- Active 2D tab target: 2D only.
- Active 3D tab target: 3D only.
- Debounce filter inputs (150-250 ms) and coalesce redraws with `requestAnimationFrame`.
- Precompile active filters.
- Build a compact active filter list once per filter change.
- Avoid scanning all columns when most queries are empty.
- Parse numeric filter tokens once per query update, not per cell check.
- Use Plotly `scattergl` for large 2D point counts (threshold-based switch).

Expected impact:
- noticeably reduced keystroke lag,
- lower redraw frequency,
- lower CPU spikes on filter edits.

## Set 2: Targeted Architecture Upgrade (Medium risk, 1-2 weeks)

Goal: remove core table bottleneck while preserving current UX.

- Replace full-table DOM rendering with a virtualized grid.
- Virtualize rows and columns.
- Render only viewport cells plus overscan.
- Keep sticky headers/row index in virtualization layer rather than full native table layout.
- Move parse/filter/sort/stats to a Web Worker.
- Add numeric column caches (typed arrays) to avoid repeated `toNumber` conversion in hot paths.
- Cache and reuse `viewRows` snapshots across table/stats/export within a render cycle.

Expected impact:
- major redraw-rate improvements on 10k+ x 100+ workloads,
- smoother scrolling and interaction under filter/sort operations.

## Set 3: High-Scale Redesign (Higher risk, 3-6+ weeks)

Goal: robust performance for very large datasets (50k+ to 100k+ rows).

- Adopt a columnar query layer (Arrow/DuckDB-WASM-style workflow) for filtering/sorting/stats.
- Shift table rendering to a canvas/WebGL grid for extreme cell counts.
- Introduce a state graph with incremental recomputation.
- Compute only changed nodes (filter result, sorted index, plotted series).
- Add progressive ingestion (chunked parse + incremental availability) and optional sampling/downsampling modes.

Expected impact:
- stable interactivity at much larger scales,
- better long-term foundation for advanced analytics features.

## Recommended Path

1. Execute Set 1 now to recover immediate usability.
2. Prioritize table virtualization from Set 2 as the primary structural fix.
3. Defer Set 3 until product scope confirms need for very large-scale datasets.
