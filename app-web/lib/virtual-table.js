/**
 * Row-virtualized table renderer.
 *
 * Only keeps viewport rows (+ overscan buffer) in the DOM, using top/bottom
 * spacer <tr> elements to maintain correct scroll height. For small datasets
 * where all rows fit, no spacers are inserted.
 */
export class VirtualTable {
  /**
   * @param {HTMLElement} container  – the scrollable wrapper (e.g. #tableContainer)
   * @param {object}      opts
   * @param {function}    opts.escapeHtml – HTML-escape a string value
   * @param {number}      [opts.rowHeight=29] – estimated row height in px
   * @param {number}      [opts.overscanRows=5] – extra rows above/below viewport
   */
  constructor(container, { escapeHtml, rowHeight = 29, overscanRows = 5 }) {
    this._container = container;
    this._escapeHtml = escapeHtml;
    this._estimatedRowHeight = rowHeight;
    this._rowHeight = rowHeight;
    this._overscanRows = overscanRows;
    this._calibrated = false;

    // Data state
    this._viewRows = [];
    this._visibleColumns = [];
    this._sortState = { column: null, direction: "none" };

    // Current rendered range
    this._rangeStart = 0;
    this._rangeEnd = 0;

    // DOM skeleton (created lazily on first setData)
    this._table = null;
    this._thead = null;
    this._tbody = null;

    // Scroll handling
    this._rafId = null;
    this._onScroll = () => {
      if (this._rafId !== null) return;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._renderBody();
      });
    };

    // Resize handling
    this._resizeObserver = new ResizeObserver(() => {
      this._renderBody();
    });

    this._container.addEventListener("scroll", this._onScroll, { passive: true });
    this._resizeObserver.observe(this._container);
  }

  /**
   * Provide new data and re-render the table.
   */
  setData(viewRows, visibleColumns, sortState) {
    this._viewRows = viewRows;
    this._visibleColumns = visibleColumns;
    this._sortState = sortState;

    // Reset range so body is fully re-rendered
    this._rangeStart = -1;
    this._rangeEnd = -1;

    this._ensureSkeleton();
    this._renderHeader();
    this._renderBody({ force: true });
  }

  /**
   * Show an empty-state message (no table).
   */
  showEmpty(html) {
    this._teardownSkeleton();
    this._container.classList.add("empty");
    this._container.innerHTML = html;
  }

  /**
   * Force a re-render (e.g. after resize).
   */
  refresh() {
    this._renderBody({ force: true });
  }

  /**
   * Clean up listeners and observers.
   */
  destroy() {
    this._container.removeEventListener("scroll", this._onScroll);
    this._resizeObserver.disconnect();
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  // ── Private ──────────────────────────────────────────────

  _ensureSkeleton() {
    this._container.classList.remove("empty");

    if (this._table && this._container.contains(this._table)) {
      return; // skeleton already in place
    }

    this._table = document.createElement("table");
    this._table.className = "data-table";
    this._thead = document.createElement("thead");
    this._tbody = document.createElement("tbody");
    this._table.appendChild(this._thead);
    this._table.appendChild(this._tbody);

    this._container.innerHTML = "";
    this._container.appendChild(this._table);

    this._calibrated = false;
  }

  _teardownSkeleton() {
    this._table = null;
    this._thead = null;
    this._tbody = null;
    this._calibrated = false;
  }

  _renderHeader() {
    const esc = this._escapeHtml;
    const cols = this._visibleColumns;
    const sort = this._sortState;

    const cells = cols
      .map((column) => {
        const sortIndicator =
          sort.column === column.index
            ? sort.direction === "desc"
              ? "▼"
              : sort.direction === "asc"
                ? "▲"
                : ""
            : "";

        return `<th><div class="header-cell"><div class="header-main"><span class="header-name">${esc(
          column.name
        )}</span><span class="sort-indicator">${sortIndicator}</span></div><span class="header-type ${column.type}" title="${column.type}">${column.type}</span></div></th>`;
      })
      .join("");

    this._thead.innerHTML = `<tr><th class="row-index">Row</th>${cells}</tr>`;
  }

  _renderBody({ force = false } = {}) {
    if (!this._tbody || this._viewRows.length === 0) {
      if (this._tbody) this._tbody.innerHTML = "";
      this._rangeStart = 0;
      this._rangeEnd = 0;
      return;
    }

    const totalRows = this._viewRows.length;
    const scrollTop = this._container.scrollTop;
    const viewportHeight = this._container.clientHeight;
    const rh = this._rowHeight;

    const firstVisible = Math.floor(scrollTop / rh);
    const visibleCount = Math.ceil(viewportHeight / rh) + 1;

    const start = Math.max(0, firstVisible - this._overscanRows);
    const end = Math.min(totalRows, firstVisible + visibleCount + this._overscanRows);

    // Skip re-render if range hasn't changed
    if (!force && start === this._rangeStart && end === this._rangeEnd) {
      return;
    }

    this._rangeStart = start;
    this._rangeEnd = end;

    const esc = this._escapeHtml;
    const cols = this._visibleColumns;
    const colCount = cols.length + 1; // +1 for row-index th

    const parts = [];

    // Top spacer
    const topHeight = start * rh;
    if (topHeight > 0) {
      parts.push(
        `<tr data-virtual-spacer="top" style="height:${topHeight}px;visibility:hidden"><td colspan="${colCount}" style="padding:0;border:0;line-height:0"></td></tr>`
      );
    }

    // Data rows
    for (let i = start; i < end; i++) {
      const entry = this._viewRows[i];
      const cells = cols
        .map((column) => {
          const safe = esc(entry.values[column.index]);
          return `<td title="${safe}">${safe}</td>`;
        })
        .join("");
      parts.push(
        `<tr><th class="row-index">${entry.sourceIndex.toLocaleString()}</th>${cells}</tr>`
      );
    }

    // Bottom spacer
    const bottomHeight = (totalRows - end) * rh;
    if (bottomHeight > 0) {
      parts.push(
        `<tr data-virtual-spacer="bottom" style="height:${bottomHeight}px;visibility:hidden"><td colspan="${colCount}" style="padding:0;border:0;line-height:0"></td></tr>`
      );
    }

    this._tbody.innerHTML = parts.join("");

    // Calibrate row height after first real render
    if (!this._calibrated) {
      this._calibrate();
    }
  }

  _calibrate() {
    const row = this._tbody.querySelector("tr:not([data-virtual-spacer])");
    if (!row) return;

    const measured = row.getBoundingClientRect().height;
    if (measured > 0 && Math.abs(measured - this._rowHeight) > 1) {
      this._rowHeight = measured;
      // Re-render with corrected height
      this._rangeStart = -1;
      this._rangeEnd = -1;
      this._calibrated = true;
      this._renderBody({ force: true });
      return;
    }
    this._calibrated = true;
  }
}
