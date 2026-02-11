# Issue Set: Targeted Architecture Upgrade

Status: `todo`  
Source: Set 2 from `docs/performance-report.md`

## User Story

As a power user exploring large tables, I want the grid to render only what is visible and data processing to run off the main UI thread so that scrolling, filtering, and sorting remain consistently smooth.

## Validation

Validation will be complete when all checks below pass on large fixtures (including `tests/data/stress_single_header_25000_rows_300_cols.csv`):

- Virtualized table behavior:
  - Row virtualization is active (viewport rows + overscan only).
  - Column virtualization is active for wide datasets.
  - Sticky header and sticky row index remain correct during scroll.
- Workerized data operations:
  - Parse/filter/sort/stats work executes in a Web Worker path.
  - Main thread remains responsive while worker computations run.
- Numeric cache path:
  - Numeric conversion is cached/reused for repeated filter/sort/stats operations.
- View consistency:
  - Table, quick stats, and export all use the same computed view snapshot for a render cycle.
- UX and correctness:
  - Sort/filter outputs match current behavior for existing fixtures and tests.
  - No regression in preset load/apply behavior.
- Performance checks:
  - Scroll FPS and interaction latency are improved vs baseline report.
  - Large-view redraw no longer relies on full `innerHTML` replacement of 2000-row table slices.
