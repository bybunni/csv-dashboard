# ADR 0001: Adaptive Table Render Budget for Wide CSVs

Date: 2026-02-11  
Status: Accepted

## Context

The Data tab redraw path was still visibly slow on large CSVs after initial stabilization work, especially for very wide datasets (100+ to 300+ visible columns).

Even with a fixed `MAX_TABLE_ROWS` cap of 2000, total rendered cells remained too large:

- 2000 x 100 = 200,000 cells
- 2000 x 300 = 600,000 cells

This caused expensive DOM creation, layout, and paint on every filter/sort redraw. Perceived latency remained high.

## Decision

Use an adaptive row cap based on a fixed maximum rendered-cell budget instead of a fixed row-only cap.

Implemented controls:

- `MAX_TABLE_RENDER_CELLS = 120000`
- `MIN_TABLE_ROWS = 120`
- `MAX_TABLE_ROWS = 2000` (existing upper bound retained)

Runtime behavior:

- `rowLimit = clamp(floor(MAX_TABLE_RENDER_CELLS / visibleColumns), MIN_TABLE_ROWS, MAX_TABLE_ROWS)`
- Table renders `viewRows.slice(0, rowLimit)` instead of always slicing to 2000.

Additional payload reduction:

- Disable per-cell `title` tooltips when rendered cell count is above `MAX_CELL_TOOLTIP_CELLS = 40000`.
- Keep header/type tooltips and metadata labels for discoverability.

## Rationale

The dominant remaining bottleneck was proportional to cell count, not row count alone. Bounding rendered cells directly gives predictable upper cost across narrow and wide tables.

This change avoids a full grid virtualization rewrite while delivering immediate perceptible improvement.

## Consequences

Positive:

- Significant Data-tab responsiveness improvement on wide CSVs.
- Lower DOM and layout pressure during frequent redraw events.
- Maintains existing table UX model and keeps implementation risk low.

Tradeoffs:

- Fewer visible rows for very wide views.
- Some cell hover tooltips are unavailable in high-cell-count scenarios.
- This is still a DOM table approach, not full virtualization.

## Example Limits

With current constants:

- 100 columns -> 1200 rows
- 150 columns -> 800 rows
- 300 columns -> 400 rows
- 500 columns -> 240 rows

## Validation

Verified with automated tests after implementation:

- Unit tests passed (`npm run test:unit`)
- E2E tests passed (`npm run test:e2e`)

Manual perception check from user feedback: "that made a huge difference."

## Follow-up

- Tune `MAX_TABLE_RENDER_CELLS` and `MAX_CELL_TOOLTIP_CELLS` if needed from real usage telemetry.
- If larger-scale requirements continue growing, promote table virtualization from planned architecture upgrades.
