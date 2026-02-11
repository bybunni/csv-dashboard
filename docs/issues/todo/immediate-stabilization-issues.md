# Issue Set: Immediate Stabilization

Status: `todo`  
Source: Set 1 from `docs/performance-report.md`

## User Story

As an analyst working with CSV files that are 10,000+ rows and 100+ columns, I want filter/sort/plot interactions to stay responsive so I can explore data without keystroke lag and UI stalls.

## Validation

Validation will be complete when all checks below pass on a large fixture (for example `tests/data/stress_single_header_25000_rows_300_cols.csv`):

- Active-tab redraw only:
  - Changing data controls updates Data view without redrawing hidden plot tabs.
  - Changing 2D controls updates only active 2D plot state.
  - Changing 3D controls updates only active 3D plot state.
- Input responsiveness:
  - Per-column filter typing is debounced and does not trigger a full redraw on every keystroke.
  - Visual interaction remains smooth while typing a 10-character filter quickly.
- Data-op efficiency:
  - Filtering uses precompiled active filters instead of scanning all empty filter slots.
  - Numeric filter parsing is cached/precomputed per query update.
- Plot efficiency:
  - 2D plots switch to `scattergl` when point count crosses the configured threshold.
- Performance checks:
  - No long-task spikes from full redraws during rapid filter input.
  - Measured redraw latency is materially lower than current baseline from `docs/performance-report.md`.

