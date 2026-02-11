# Issue Set: High-Scale Redesign

Status: `done (definition complete, implementation pending)`  
Source: Set 3 from `docs/performance-report.md`

## User Story

As a user working with very large datasets (50,000+ to 100,000+ rows), I want a high-scale data engine and rendering path so that deep filtering, sorting, plotting, and navigation remain interactive instead of blocking.

## Validation

Validation will be complete when all checks below pass in a high-scale benchmark run:

- Columnar execution path:
  - Filtering/sorting/stats run on a columnar query backend (for example Arrow- or DuckDB-WASM-based).
  - Query results are mapped back to visible row order without correctness drift.
- High-scale rendering path:
  - Table view uses a high-density renderer (virtualized canvas/WebGL grid or equivalent).
  - Visible viewport interactions remain smooth at target dataset sizes.
- Incremental recomputation:
  - State graph recomputes only affected nodes for control changes.
  - Unchanged views are not recomputed/redrawn.
- Progressive ingestion:
  - CSV ingest supports chunked processing.
  - Users can begin interacting before full-file completion where feasible.
- Quality gates:
  - Statistical outputs match trusted reference calculations.
  - Existing unit/e2e behavior for small and medium datasets remains correct.
- Performance targets:
  - Defined p95 latency goals are met for filter apply, sort apply, and initial render at high-scale fixture sizes.
  - Long-task time and dropped-frame rates are materially below current baseline.

