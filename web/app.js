import {
  clamp,
  escapeHtml,
  inferColumnTypes,
  normalizeRows,
  parseCsv,
  toNumber,
  valueToNullableNumber,
} from "./lib/csv-core.js";

const MAX_TABLE_ROWS = 2000;
const DEFAULT_3D_CAMERA = {
  eye: { x: 1.65, y: 1.45, z: 1.2 },
};

const palette = [
  "#0f766e",
  "#0ea5e9",
  "#7c3aed",
  "#dc2626",
  "#ca8a04",
  "#16a34a",
  "#ea580c",
  "#1d4ed8",
  "#a21caf",
  "#475569",
];

const state = {
  fileName: "",
  delimiter: ",",
  headers: [],
  rows: [],
  columns: [],
  tab: "data",
  dataOps: {
    filters: {},
    sortColumn: null,
    sortDirection: "none",
    statsColumn: null,
  },
  plot2d: {
    useIndexX: true,
    xColumn: null,
    yColumns: new Set(),
    style: "both",
  },
  plot3d: {
    xColumn: null,
    yColumn: null,
    zColumn: null,
    colorColumn: null,
    sizeColumn: null,
    baseSize: 4,
    camera: { ...DEFAULT_3D_CAMERA },
    relayoutBound: false,
  },
};

const els = {
  dropZone: document.getElementById("dropZone"),
  browseBtn: document.getElementById("browseBtn"),
  fileInput: document.getElementById("fileInput"),
  statusBar: document.getElementById("statusBar"),
  tabs: document.querySelectorAll(".tab"),
  panels: {
    data: document.getElementById("panel-data"),
    plot2d: document.getElementById("panel-plot2d"),
    plot3d: document.getElementById("panel-plot3d"),
  },
  tableContainer: document.getElementById("tableContainer"),
  tableMeta: document.getElementById("tableMeta"),
  sortColumnSelect: document.getElementById("sortColumnSelect"),
  sortDirectionSelect: document.getElementById("sortDirectionSelect"),
  clearSortBtn: document.getElementById("clearSortBtn"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  filterControls: document.getElementById("filterControls"),
  statsColumnSelect: document.getElementById("statsColumnSelect"),
  quickStats: document.getElementById("quickStats"),
  xIndexMode: document.getElementById("xIndexMode"),
  xSelect2d: document.getElementById("xSelect2d"),
  plotStyle2d: document.getElementById("plotStyle2d"),
  yColumns2d: document.getElementById("yColumns2d"),
  plot2d: document.getElementById("plot2d"),
  legend2d: document.getElementById("legend2d"),
  xSelect3d: document.getElementById("xSelect3d"),
  ySelect3d: document.getElementById("ySelect3d"),
  zSelect3d: document.getElementById("zSelect3d"),
  colorSelect3d: document.getElementById("colorSelect3d"),
  sizeSelect3d: document.getElementById("sizeSelect3d"),
  pointSize3d: document.getElementById("pointSize3d"),
  pointSizeValue3d: document.getElementById("pointSizeValue3d"),
  reset3dView: document.getElementById("reset3dView"),
  plot3d: document.getElementById("plot3d"),
  meta3d: document.getElementById("meta3d"),
};

init();

function init() {
  bindTabControls();
  bindDropZone();
  bindDataControls();
  bind2dControls();
  bind3dControls();
  refreshSelectors();
  renderViews();

  window.addEventListener("resize", () => {
    if (!window.Plotly) {
      return;
    }
    if (state.tab === "plot2d") {
      window.Plotly.Plots.resize(els.plot2d);
    }
    if (state.tab === "plot3d") {
      window.Plotly.Plots.resize(els.plot3d);
    }
  });
}

function bindTabControls() {
  els.tabs.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
}

function setTab(tab) {
  state.tab = tab;
  els.tabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  Object.entries(els.panels).forEach(([key, panel]) => {
    panel.classList.toggle("active", key === tab);
  });

  const viewRows = buildViewRows();
  if (tab === "plot2d") {
    draw2D(viewRows);
  }
  if (tab === "plot3d") {
    draw3D(viewRows);
  }
}

function bindDropZone() {
  els.browseBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      loadCsvFile(file);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "dragleave" && event.relatedTarget && els.dropZone.contains(event.relatedTarget)) {
        return;
      }
      els.dropZone.classList.remove("drag-over");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || files.length === 0) {
      return;
    }
    loadCsvFile(files[0]);
  });
}

function bindDataControls() {
  els.sortColumnSelect.addEventListener("change", () => {
    state.dataOps.sortColumn = valueToNullableNumber(els.sortColumnSelect.value);
    renderViews();
  });

  els.sortDirectionSelect.addEventListener("change", () => {
    state.dataOps.sortDirection = els.sortDirectionSelect.value;
    renderViews();
  });

  els.clearSortBtn.addEventListener("click", () => {
    state.dataOps.sortColumn = null;
    state.dataOps.sortDirection = "none";
    els.sortColumnSelect.value = "";
    els.sortDirectionSelect.value = "none";
    renderViews();
  });

  els.clearFiltersBtn.addEventListener("click", () => {
    Object.keys(state.dataOps.filters).forEach((key) => {
      state.dataOps.filters[key] = "";
    });
    els.filterControls.querySelectorAll("input[data-col-index]").forEach((input) => {
      input.value = "";
    });
    renderViews();
  });

  els.filterControls.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const colIndex = target.dataset.colIndex;
    if (colIndex === undefined) {
      return;
    }
    state.dataOps.filters[colIndex] = target.value;
    renderViews();
  });

  els.statsColumnSelect.addEventListener("change", () => {
    state.dataOps.statsColumn = valueToNullableNumber(els.statsColumnSelect.value);
    const viewRows = buildViewRows();
    renderQuickStats(viewRows);
  });
}

function bind2dControls() {
  els.xIndexMode.addEventListener("change", () => {
    state.plot2d.useIndexX = els.xIndexMode.checked;
    els.xSelect2d.disabled = state.plot2d.useIndexX;
    draw2D(buildViewRows());
  });

  els.xSelect2d.addEventListener("change", () => {
    state.plot2d.xColumn = valueToNullableNumber(els.xSelect2d.value);
    draw2D(buildViewRows());
  });

  els.plotStyle2d.addEventListener("change", () => {
    state.plot2d.style = els.plotStyle2d.value;
    draw2D(buildViewRows());
  });
}

function bind3dControls() {
  els.xSelect3d.addEventListener("change", () => {
    state.plot3d.xColumn = valueToNullableNumber(els.xSelect3d.value);
    draw3D(buildViewRows());
  });

  els.ySelect3d.addEventListener("change", () => {
    state.plot3d.yColumn = valueToNullableNumber(els.ySelect3d.value);
    draw3D(buildViewRows());
  });

  els.zSelect3d.addEventListener("change", () => {
    state.plot3d.zColumn = valueToNullableNumber(els.zSelect3d.value);
    draw3D(buildViewRows());
  });

  els.colorSelect3d.addEventListener("change", () => {
    state.plot3d.colorColumn = valueToNullableNumber(els.colorSelect3d.value);
    draw3D(buildViewRows());
  });

  els.sizeSelect3d.addEventListener("change", () => {
    state.plot3d.sizeColumn = valueToNullableNumber(els.sizeSelect3d.value);
    draw3D(buildViewRows());
  });

  els.pointSize3d.addEventListener("input", () => {
    state.plot3d.baseSize = Number(els.pointSize3d.value);
    els.pointSizeValue3d.textContent = String(state.plot3d.baseSize);
    draw3D(buildViewRows());
  });

  els.reset3dView.addEventListener("click", () => {
    state.plot3d.camera = { ...DEFAULT_3D_CAMERA };
    draw3D(buildViewRows());
  });
}

async function loadCsvFile(file) {
  if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
    setStatus("Selected file does not look like a CSV. Parsing anyway.", "warn");
  } else {
    setStatus(`Reading ${file.name}...`, "muted");
  }

  try {
    const text = await file.text();
    const parsed = parseCsv(text);

    if (parsed.rows.length < 1) {
      throw new Error("No rows were found.");
    }

    const { headers, dataRows } = normalizeRows(parsed.rows);

    if (headers.length === 0) {
      throw new Error("No columns were found.");
    }

    state.fileName = file.name;
    state.delimiter = parsed.delimiter;
    state.headers = headers;
    state.rows = dataRows;
    state.columns = inferColumnTypes(headers, dataRows);

    initializeDataOps();
    initializePlotSelections();
    refreshSelectors();
    renderViews();

    const numericCount = state.columns.filter((column) => column.type === "number").length;
    setStatus(
      `Loaded ${file.name}: ${state.rows.length.toLocaleString()} rows, ${state.headers.length.toLocaleString()} columns, delimiter '${renderDelimiter(
        state.delimiter
      )}', numeric columns ${numericCount}.`,
      "ok"
    );
  } catch (error) {
    clearLoadedData();
    refreshSelectors();
    renderViews();
    setStatus(`Could not parse CSV: ${error.message}`, "error");
  }
}

function renderDelimiter(delimiter) {
  if (delimiter === "\t") {
    return "tab";
  }
  return delimiter;
}

function clearLoadedData() {
  state.fileName = "";
  state.delimiter = ",";
  state.headers = [];
  state.rows = [];
  state.columns = [];

  state.dataOps.filters = {};
  state.dataOps.sortColumn = null;
  state.dataOps.sortDirection = "none";
  state.dataOps.statsColumn = null;

  state.plot2d.yColumns = new Set();
  state.plot2d.xColumn = null;

  state.plot3d.xColumn = null;
  state.plot3d.yColumn = null;
  state.plot3d.zColumn = null;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
  state.plot3d.camera = { ...DEFAULT_3D_CAMERA };
}

function initializeDataOps() {
  const filters = {};
  state.headers.forEach((_, index) => {
    filters[index] = "";
  });
  state.dataOps.filters = filters;
  state.dataOps.sortColumn = null;
  state.dataOps.sortDirection = "none";

  const firstNumeric = state.columns.find((column) => column.type === "number");
  state.dataOps.statsColumn = firstNumeric ? firstNumeric.index : state.headers.length ? 0 : null;
}

function initializePlotSelections() {
  const numericColumns = state.columns.filter((column) => column.type === "number");

  state.plot2d.useIndexX = true;
  state.plot2d.style = "both";
  state.plot2d.xColumn = numericColumns.length ? numericColumns[0].index : null;
  state.plot2d.yColumns = new Set(numericColumns.slice(0, 3).map((column) => column.index));

  state.plot3d.xColumn = numericColumns[0] ? numericColumns[0].index : null;
  state.plot3d.yColumn = numericColumns[1] ? numericColumns[1].index : state.plot3d.xColumn;
  state.plot3d.zColumn = numericColumns[2] ? numericColumns[2].index : state.plot3d.yColumn;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
  state.plot3d.baseSize = 4;
  state.plot3d.camera = { ...DEFAULT_3D_CAMERA };
}

function refreshSelectors() {
  const numericColumns = state.columns.filter((column) => column.type === "number");

  renderDataControls();
  render2dSelectors(numericColumns);
  render3dSelectors(numericColumns);

  els.pointSize3d.value = String(state.plot3d.baseSize);
  els.pointSizeValue3d.textContent = String(state.plot3d.baseSize);
}

function renderDataControls() {
  renderSortControls();
  renderFilterControls();
  renderStatsControls();
}

function renderSortControls() {
  if (state.headers.length === 0) {
    els.sortColumnSelect.innerHTML = "<option value=''>None</option>";
    els.sortColumnSelect.disabled = true;
    els.sortDirectionSelect.value = "none";
    els.sortDirectionSelect.disabled = true;
    els.clearSortBtn.disabled = true;
    return;
  }

  const options = ["<option value=''>None</option>"];
  state.columns.forEach((column) => {
    options.push(`<option value="${column.index}">${escapeHtml(column.name)}</option>`);
  });

  els.sortColumnSelect.innerHTML = options.join("");
  els.sortColumnSelect.value = state.dataOps.sortColumn === null ? "" : String(state.dataOps.sortColumn);
  els.sortColumnSelect.disabled = false;
  els.sortDirectionSelect.disabled = false;
  els.sortDirectionSelect.value = state.dataOps.sortDirection;
  els.clearSortBtn.disabled = false;
}

function renderFilterControls() {
  if (state.headers.length === 0) {
    els.filterControls.innerHTML = "<div class='muted'>No columns loaded.</div>";
    els.clearFiltersBtn.disabled = true;
    return;
  }

  const html = state.columns
    .map((column) => {
      const placeholder = column.type === "number" ? "contains / >10 / <=5 / 1..9" : "contains text";
      const value = state.dataOps.filters[column.index] || "";

      return `
        <div class="filter-row">
          <label for="filter-col-${column.index}">${escapeHtml(column.name)} (${column.type})</label>
          <input
            id="filter-col-${column.index}"
            data-col-index="${column.index}"
            value="${escapeHtml(value)}"
            placeholder="${placeholder}"
          />
        </div>
      `;
    })
    .join("");

  els.filterControls.innerHTML = html;
  els.clearFiltersBtn.disabled = false;
}

function renderStatsControls() {
  if (state.headers.length === 0) {
    els.statsColumnSelect.innerHTML = "<option value=''>None</option>";
    els.statsColumnSelect.disabled = true;
    return;
  }

  els.statsColumnSelect.innerHTML = state.columns
    .map((column) => `<option value="${column.index}">${escapeHtml(column.name)} (${column.type})</option>`)
    .join("");

  if (state.dataOps.statsColumn === null || !state.columns[state.dataOps.statsColumn]) {
    state.dataOps.statsColumn = state.columns[0].index;
  }

  els.statsColumnSelect.disabled = false;
  els.statsColumnSelect.value = String(state.dataOps.statsColumn);
}

function render2dSelectors(numericColumns) {
  populateSelect(els.xSelect2d, numericColumns, state.plot2d.xColumn);
  els.xIndexMode.checked = state.plot2d.useIndexX;
  els.xSelect2d.disabled = state.plot2d.useIndexX || numericColumns.length === 0;
  els.plotStyle2d.value = state.plot2d.style;

  if (numericColumns.length === 0) {
    els.yColumns2d.innerHTML = "<div class='muted'>No numeric columns detected.</div>";
    state.plot2d.yColumns = new Set();
    return;
  }

  const selected = new Set(state.plot2d.yColumns);
  const html = numericColumns
    .map(
      (column) => `
        <label class="checklist-item" title="${escapeHtml(column.name)}">
          <input type="checkbox" data-col-index="${column.index}" ${selected.has(column.index) ? "checked" : ""} />
          <span>${escapeHtml(column.name)}</span>
        </label>
      `
    )
    .join("");

  els.yColumns2d.innerHTML = html;

  els.yColumns2d.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const col = Number(checkbox.dataset.colIndex);
      if (checkbox.checked) {
        state.plot2d.yColumns.add(col);
      } else {
        state.plot2d.yColumns.delete(col);
      }
      draw2D(buildViewRows());
    });
  });
}

function render3dSelectors(numericColumns) {
  populateSelect(els.xSelect3d, numericColumns, state.plot3d.xColumn);
  populateSelect(els.ySelect3d, numericColumns, state.plot3d.yColumn);
  populateSelect(els.zSelect3d, numericColumns, state.plot3d.zColumn);
  populateOptionalSelect(els.colorSelect3d, numericColumns, state.plot3d.colorColumn);
  populateOptionalSelect(els.sizeSelect3d, numericColumns, state.plot3d.sizeColumn);
}

function populateSelect(selectEl, columns, selectedValue) {
  if (!columns.length) {
    selectEl.innerHTML = "<option value=''>No numeric columns</option>";
    selectEl.disabled = true;
    return;
  }

  selectEl.disabled = false;
  selectEl.innerHTML = columns
    .map(
      (column) =>
        `<option value="${column.index}" ${column.index === selectedValue ? "selected" : ""}>${escapeHtml(column.name)}</option>`
    )
    .join("");

  if (!columns.some((column) => column.index === selectedValue)) {
    selectEl.value = String(columns[0].index);
  }
}

function populateOptionalSelect(selectEl, columns, selectedValue) {
  const options = ["<option value=''>None</option>"];
  options.push(
    ...columns.map(
      (column) =>
        `<option value="${column.index}" ${column.index === selectedValue ? "selected" : ""}>${escapeHtml(column.name)}</option>`
    )
  );

  selectEl.innerHTML = options.join("");
  selectEl.disabled = columns.length === 0;
  selectEl.value = selectedValue === null ? "" : String(selectedValue);
}

function renderViews() {
  const viewRows = buildViewRows();
  renderTable(viewRows);
  renderQuickStats(viewRows);
  draw2D(viewRows);
  draw3D(viewRows);
}

function buildViewRows() {
  if (state.rows.length === 0) {
    return [];
  }

  let rows = state.rows
    .map((values, index) => ({
      values,
      sourceIndex: index + 1,
    }))
    .filter((entry) => rowMatchesFilters(entry.values));

  if (state.dataOps.sortColumn !== null && state.dataOps.sortDirection !== "none") {
    const columnIndex = state.dataOps.sortColumn;
    const type = state.columns[columnIndex]?.type || "string";
    const direction = state.dataOps.sortDirection === "desc" ? -1 : 1;

    rows = rows.slice().sort((left, right) => {
      const cmp = compareCellValues(left.values[columnIndex], right.values[columnIndex], type);
      if (cmp !== 0) {
        return cmp * direction;
      }
      return left.sourceIndex - right.sourceIndex;
    });
  }

  return rows;
}

function rowMatchesFilters(rowValues) {
  for (let index = 0; index < state.columns.length; index += 1) {
    const query = (state.dataOps.filters[index] || "").trim();
    if (!query) {
      continue;
    }

    const type = state.columns[index].type;
    const cell = rowValues[index] || "";

    if (!cellMatchesFilter(cell, query, type)) {
      return false;
    }
  }
  return true;
}

function cellMatchesFilter(cell, query, type) {
  const text = String(cell);
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (type === "number") {
    const numericFilter = parseNumericFilter(query);
    const numericValue = toNumber(text);

    if (numericFilter && numericValue !== null) {
      return applyNumericFilter(numericValue, numericFilter);
    }
  }

  return normalizedText.includes(normalizedQuery);
}

function parseNumericFilter(query) {
  const raw = query.trim();
  if (!raw) {
    return null;
  }

  if (raw.includes("..")) {
    const parts = raw.split("..").map((part) => part.trim());
    if (parts.length !== 2) {
      return null;
    }
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { kind: "range", min: Math.min(min, max), max: Math.max(min, max) };
    }
  }

  const match = raw.match(/^(<=|>=|!=|=|<|>)(.+)$/);
  if (match) {
    const value = Number(match[2].trim());
    if (Number.isFinite(value)) {
      return { kind: "cmp", op: match[1], value };
    }
    return null;
  }

  const direct = Number(raw);
  if (Number.isFinite(direct)) {
    return { kind: "cmp", op: "=", value: direct };
  }

  return null;
}

function applyNumericFilter(value, filter) {
  if (filter.kind === "range") {
    return value >= filter.min && value <= filter.max;
  }

  if (filter.op === "<") return value < filter.value;
  if (filter.op === "<=") return value <= filter.value;
  if (filter.op === ">") return value > filter.value;
  if (filter.op === ">=") return value >= filter.value;
  if (filter.op === "!=") return value !== filter.value;
  return value === filter.value;
}

function compareCellValues(left, right, type) {
  if (type === "number") {
    const leftNumeric = toNumber(left);
    const rightNumeric = toNumber(right);

    if (leftNumeric !== null && rightNumeric !== null) {
      return leftNumeric - rightNumeric;
    }
    if (leftNumeric !== null) {
      return -1;
    }
    if (rightNumeric !== null) {
      return 1;
    }
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function renderTable(viewRows) {
  if (state.headers.length === 0) {
    els.tableContainer.classList.add("empty");
    els.tableContainer.innerHTML = '<div class="empty-message">Load a CSV to view rows and columns.</div>';
    els.tableMeta.textContent = "";
    return;
  }

  els.tableContainer.classList.remove("empty");

  const shown = viewRows.slice(0, MAX_TABLE_ROWS);
  const headerCells = state.headers
    .map((header, index) => {
      const column = state.columns[index];
      const sortIndicator =
        state.dataOps.sortColumn === index
          ? state.dataOps.sortDirection === "desc"
            ? "▼"
            : state.dataOps.sortDirection === "asc"
              ? "▲"
              : ""
          : "";

      return `<th title="${escapeHtml(header)}"><div class="header-cell"><span>${escapeHtml(header)} ${sortIndicator}</span><span class="type-chip ${column.type}">${column.type}</span></div></th>`;
    })
    .join("");

  const bodyRows = shown
    .map((entry) => {
      const cells = entry.values
        .map((value) => {
          const safe = escapeHtml(value);
          return `<td title="${safe}">${safe}</td>`;
        })
        .join("");
      return `<tr><th class="row-index">${entry.sourceIndex.toLocaleString()}</th>${cells}</tr>`;
    })
    .join("");

  els.tableContainer.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th class="row-index">Row</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  const filterCount = Object.values(state.dataOps.filters).filter((value) => value.trim() !== "").length;
  const sortLabel =
    state.dataOps.sortColumn !== null && state.dataOps.sortDirection !== "none"
      ? ` · sorted by ${state.headers[state.dataOps.sortColumn]} (${state.dataOps.sortDirection})`
      : "";

  const visibleSuffix = viewRows.length > MAX_TABLE_ROWS ? ` (showing first ${MAX_TABLE_ROWS.toLocaleString()})` : "";
  const filterLabel = filterCount > 0 ? ` · ${filterCount} active filter${filterCount === 1 ? "" : "s"}` : "";

  els.tableMeta.textContent = `${viewRows.length.toLocaleString()} of ${state.rows.length.toLocaleString()} rows · ${state.headers.length.toLocaleString()} columns${filterLabel}${sortLabel}${visibleSuffix}`;
}

function renderQuickStats(viewRows) {
  if (state.headers.length === 0 || state.dataOps.statsColumn === null) {
    els.quickStats.classList.add("muted");
    els.quickStats.innerHTML = "Load a CSV to compute stats.";
    return;
  }

  const colIndex = state.dataOps.statsColumn;
  const column = state.columns[colIndex];
  const values = viewRows.map((entry) => entry.values[colIndex]);

  if (column.type === "number") {
    const numericValues = values.map((value) => toNumber(value)).filter((value) => value !== null);
    const missing = values.length - numericValues.length;

    if (numericValues.length === 0) {
      els.quickStats.classList.add("muted");
      els.quickStats.innerHTML = "No numeric values in the current filtered view.";
      return;
    }

    const sorted = numericValues.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const mean = sum / sorted.length;
    const variance = sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    els.quickStats.classList.remove("muted");
    els.quickStats.innerHTML = [
      statItem("Rows in view", formatInt(values.length)),
      statItem("Non-empty", formatInt(sorted.length)),
      statItem("Missing", formatInt(missing)),
      statItem("Min", formatNumber(sorted[0])),
      statItem("Max", formatNumber(sorted[sorted.length - 1])),
      statItem("Mean", formatNumber(mean)),
      statItem("Median", formatNumber(median)),
      statItem("Std dev", formatNumber(Math.sqrt(variance))),
    ].join("");
    return;
  }

  const normalized = values.map((value) => String(value || "").trim());
  const present = normalized.filter((value) => value !== "");
  const missing = normalized.length - present.length;
  const frequencies = new Map();

  present.forEach((value) => {
    frequencies.set(value, (frequencies.get(value) || 0) + 1);
  });

  const topValues = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => `${value} (${count})`)
    .join(", ");

  els.quickStats.classList.remove("muted");
  els.quickStats.innerHTML = [
    statItem("Rows in view", formatInt(values.length)),
    statItem("Non-empty", formatInt(present.length)),
    statItem("Missing", formatInt(missing)),
    statItem("Unique", formatInt(frequencies.size)),
    statItem("Top values", escapeHtml(topValues || "none")),
  ].join("");
}

function statItem(label, value) {
  return `<div class="stat-item"><span class="stat-key">${escapeHtml(label)}</span><span class="stat-val">${value}</span></div>`;
}

function draw2D(viewRows) {
  if (!window.Plotly) {
    setPlotUnavailable(els.plot2d, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    els.legend2d.textContent = "Plotly unavailable.";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(els.plot2d, "Load CSV data to render a chart.");
    els.legend2d.textContent = "Select one or more numeric Y columns to plot.";
    return;
  }

  const yColumns = [...state.plot2d.yColumns];
  if (yColumns.length === 0) {
    renderEmptyPlot(els.plot2d, "Select at least one numeric Y column.");
    els.legend2d.textContent = "No Y columns selected.";
    return;
  }

  if (!state.plot2d.useIndexX && state.plot2d.xColumn === null) {
    renderEmptyPlot(els.plot2d, "Select an X column or use row index.");
    els.legend2d.textContent = "X axis is not configured.";
    return;
  }

  const traces = [];
  const styleMode =
    state.plot2d.style === "line" ? "lines" : state.plot2d.style === "scatter" ? "markers" : "lines+markers";

  yColumns.forEach((yColumn, seriesIndex) => {
    const x = [];
    const y = [];

    viewRows.forEach((entry, rowIndex) => {
      const yValue = toNumber(entry.values[yColumn]);
      if (yValue === null) {
        return;
      }

      const xValue = state.plot2d.useIndexX ? rowIndex + 1 : toNumber(entry.values[state.plot2d.xColumn]);
      if (xValue === null) {
        return;
      }

      x.push(xValue);
      y.push(yValue);
    });

    if (x.length === 0) {
      return;
    }

    traces.push({
      x,
      y,
      name: state.headers[yColumn],
      type: "scatter",
      mode: styleMode,
      marker: {
        size: state.plot2d.style === "line" ? 0 : 5,
        color: palette[seriesIndex % palette.length],
      },
      line: {
        width: 2,
        color: palette[seriesIndex % palette.length],
      },
    });
  });

  if (traces.length === 0) {
    renderEmptyPlot(els.plot2d, "No numeric rows available for current selections.");
    els.legend2d.textContent = "No plottable values were found.";
    return;
  }

  const xLabel = state.plot2d.useIndexX ? "Row index" : state.headers[state.plot2d.xColumn] || "X";

  window.Plotly.react(
    els.plot2d,
    traces,
    {
      margin: { t: 34, r: 24, b: 48, l: 60 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#ffffff",
      xaxis: { title: xLabel, zeroline: false, gridcolor: "#e2e8f0" },
      yaxis: { title: "Y", zeroline: false, gridcolor: "#e2e8f0" },
      legend: { orientation: "h", y: 1.15 },
      hovermode: "closest",
    },
    plotConfig()
  );

  const totalPoints = traces.reduce((sum, trace) => sum + trace.x.length, 0);
  const items = traces
    .map(
      (trace, idx) =>
        `<span class="legend-item"><span class="swatch" style="background:${palette[idx % palette.length]}"></span>${escapeHtml(
          trace.name
        )} (${trace.x.length.toLocaleString()})</span>`
    )
    .join("");

  els.legend2d.innerHTML = `<div>${traces.length.toLocaleString()} series · ${totalPoints.toLocaleString()} points</div><div class="legend-grid">${items}</div>`;
}

function draw3D(viewRows) {
  if (!window.Plotly) {
    setPlotUnavailable(els.plot3d, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    els.meta3d.textContent = "Plotly unavailable.";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(els.plot3d, "Load CSV data to render a 3D view.", true);
    els.meta3d.textContent = "Select X, Y, and Z numeric columns.";
    return;
  }

  if (state.plot3d.xColumn === null || state.plot3d.yColumn === null || state.plot3d.zColumn === null) {
    renderEmptyPlot(els.plot3d, "Select numeric X, Y, and Z columns.", true);
    els.meta3d.textContent = "3D axes are not fully configured.";
    return;
  }

  const x = [];
  const y = [];
  const z = [];
  const colorRaw = [];
  const sizeRaw = [];

  const hasColor = state.plot3d.colorColumn !== null;
  const hasSize = state.plot3d.sizeColumn !== null;

  viewRows.forEach((entry) => {
    const xValue = toNumber(entry.values[state.plot3d.xColumn]);
    const yValue = toNumber(entry.values[state.plot3d.yColumn]);
    const zValue = toNumber(entry.values[state.plot3d.zColumn]);

    if (xValue === null || yValue === null || zValue === null) {
      return;
    }

    x.push(xValue);
    y.push(yValue);
    z.push(zValue);

    if (hasColor) {
      colorRaw.push(toNumber(entry.values[state.plot3d.colorColumn]));
    }
    if (hasSize) {
      sizeRaw.push(toNumber(entry.values[state.plot3d.sizeColumn]));
    }
  });

  if (x.length === 0) {
    renderEmptyPlot(els.plot3d, "No numeric rows available for selected axes.", true);
    els.meta3d.textContent = "No plottable 3D points were found.";
    return;
  }

  const marker = {
    opacity: 0.85,
    size: state.plot3d.baseSize,
    color: "#0f766e",
  };

  if (hasColor) {
    const validColors = colorRaw.filter((value) => value !== null);
    if (validColors.length > 0) {
      const fallback = validColors[0];
      marker.color = colorRaw.map((value) => (value === null ? fallback : value));
      marker.colorscale = "Viridis";
      marker.colorbar = {
        title: state.headers[state.plot3d.colorColumn],
        thickness: 10,
      };
      marker.showscale = true;
    }
  }

  if (hasSize) {
    const validSizes = sizeRaw.filter((value) => value !== null);
    if (validSizes.length > 0) {
      const min = Math.min(...validSizes);
      const max = Math.max(...validSizes);
      const span = max - min || 1;
      const base = state.plot3d.baseSize;

      marker.size = sizeRaw.map((value) => {
        if (value === null) {
          return base;
        }
        const normalized = (value - min) / span;
        return clamp(base * (0.65 + normalized * 2), 1, 18);
      });
    }
  }

  const trace = {
    type: "scatter3d",
    mode: "markers",
    x,
    y,
    z,
    marker,
  };

  const layout = {
    margin: { t: 20, r: 16, b: 12, l: 8 },
    paper_bgcolor: "rgba(0,0,0,0)",
    scene: {
      xaxis: { title: state.headers[state.plot3d.xColumn], gridcolor: "#e2e8f0" },
      yaxis: { title: state.headers[state.plot3d.yColumn], gridcolor: "#e2e8f0" },
      zaxis: { title: state.headers[state.plot3d.zColumn], gridcolor: "#e2e8f0" },
      camera: state.plot3d.camera || { ...DEFAULT_3D_CAMERA },
    },
  };

  window.Plotly.react(els.plot3d, [trace], layout, plotConfig());
  bind3dRelayoutHandler();

  const colorLabel = state.plot3d.colorColumn === null ? "none" : state.headers[state.plot3d.colorColumn];
  const sizeLabel = state.plot3d.sizeColumn === null ? "none" : state.headers[state.plot3d.sizeColumn];

  els.meta3d.textContent = `Points: ${x.length.toLocaleString()} · Axes: ${state.headers[state.plot3d.xColumn]}, ${state.headers[state.plot3d.yColumn]}, ${state.headers[state.plot3d.zColumn]} · Color: ${colorLabel} · Size: ${sizeLabel}`;
}

function bind3dRelayoutHandler() {
  if (state.plot3d.relayoutBound) {
    return;
  }
  if (typeof els.plot3d.on !== "function") {
    return;
  }

  els.plot3d.on("plotly_relayout", (eventData) => {
    if (eventData && eventData["scene.camera"]) {
      state.plot3d.camera = eventData["scene.camera"];
    }
  });

  state.plot3d.relayoutBound = true;
}

function plotConfig() {
  return {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  };
}

function renderEmptyPlot(target, message, is3d = false) {
  if (!window.Plotly) {
    setPlotUnavailable(target, message);
    return;
  }

  const layout = {
    margin: { t: 20, r: 20, b: 20, l: 20 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#ffffff",
    annotations: [
      {
        text: message,
        showarrow: false,
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        font: { color: "#64748b", size: 14 },
      },
    ],
  };

  if (is3d) {
    layout.scene = {
      xaxis: { visible: false },
      yaxis: { visible: false },
      zaxis: { visible: false },
    };
  } else {
    layout.xaxis = { visible: false };
    layout.yaxis = { visible: false };
  }

  window.Plotly.react(target, [], layout, plotConfig());
}

function setPlotUnavailable(target, message) {
  target.innerHTML = `<div class="plot-message">${escapeHtml(message)}</div>`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const abs = Math.abs(value);
  if (abs >= 1_000_000 || (abs > 0 && abs < 0.001)) {
    return value.toExponential(3);
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function formatInt(value) {
  return Number(value).toLocaleString();
}

function setStatus(text, kind) {
  els.statusBar.textContent = text;
  els.statusBar.classList.remove("ok", "error", "warn", "muted");
  els.statusBar.classList.add(kind || "muted");
}
