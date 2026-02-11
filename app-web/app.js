import {
  clamp,
  escapeHtml,
  inferColumnTypes,
  normalizeRows,
  parseCsv,
  toNumber,
  valueToNullableNumber,
} from "./lib/csv-core.js";
import {
  buildViewRows as buildViewRowsForOps,
  cellMatchesFilter,
  compileActiveFilters,
  computeQuickStats,
} from "./lib/data-ops.js";
import { parseYamlDocument, stringifyYamlDocument } from "./lib/preset-config.js";

const MAX_TABLE_ROWS = 2000;
const MAX_TABLE_RENDER_CELLS = 120000;
const MAX_CELL_TOOLTIP_CELLS = 40000;
const MIN_TABLE_ROWS = 120;
const FILTER_INPUT_DEBOUNCE_MS = 180;
const PLOT_SUBFILTER_DEBOUNCE_MS = 140;
const SCATTER_GL_POINT_THRESHOLD = 5000;
const YAML_EXTENSION_RE = /\.ya?ml$/i;
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
    compiledFilters: [],
    columnVisibility: {},
    columnVisibilityQuery: "",
    sortColumn: null,
    sortDirection: "none",
    statsColumn: null,
  },
  plots2d: {
    items: [],
    activeId: null,
    nextId: 0,
  },
  plots3d: {
    items: [],
    activeId: null,
    nextId: 0,
  },
  presets: {
    entries: [],
    selectedId: "",
    sourceDirectory: "",
    loading: false,
  },
};

const els = {
  dropZone: document.getElementById("dropZone"),
  browseBtn: document.getElementById("browseBtn"),
  fileInput: document.getElementById("fileInput"),
  statusBar: document.getElementById("statusBar"),
  exportBtn: document.getElementById("exportBtn"),
  configPresetSelect: document.getElementById("configPresetSelect"),
  applyPresetBtn: document.getElementById("applyPresetBtn"),
  loadPresetsBtn: document.getElementById("loadPresetsBtn"),
  presetDirectoryInput: document.getElementById("presetDirectoryInput"),
  savePresetName: document.getElementById("savePresetName"),
  savePresetBtn: document.getElementById("savePresetBtn"),
  presetMeta: document.getElementById("presetMeta"),
  tabs: document.querySelectorAll(".tab"),
  panels: {
    data: document.getElementById("panel-data"),
    plot2d: document.getElementById("panel-plot2d"),
    plot3d: document.getElementById("panel-plot3d"),
  },
  tableContainer: document.getElementById("tableContainer"),
  tableMeta: document.getElementById("tableMeta"),
  columnVisibilitySearch: document.getElementById("columnVisibilitySearch"),
  showAllColumnsBtn: document.getElementById("showAllColumnsBtn"),
  hideAllColumnsBtn: document.getElementById("hideAllColumnsBtn"),
  columnVisibilityMeta: document.getElementById("columnVisibilityMeta"),
  columnVisibilityControls: document.getElementById("columnVisibilityControls"),
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
  subFilterColumn2d: document.getElementById("subFilterColumn2d"),
  subFilterQuery2d: document.getElementById("subFilterQuery2d"),
  clearSubFilter2d: document.getElementById("clearSubFilter2d"),
  subFilterMeta2d: document.getElementById("subFilterMeta2d"),
  plotGrid2d: document.getElementById("plotGrid2d"),
  xSelect3d: document.getElementById("xSelect3d"),
  ySelect3d: document.getElementById("ySelect3d"),
  zSelect3d: document.getElementById("zSelect3d"),
  colorSelect3d: document.getElementById("colorSelect3d"),
  sizeSelect3d: document.getElementById("sizeSelect3d"),
  pointSize3d: document.getElementById("pointSize3d"),
  pointSizeValue3d: document.getElementById("pointSizeValue3d"),
  subFilterColumn3d: document.getElementById("subFilterColumn3d"),
  subFilterQuery3d: document.getElementById("subFilterQuery3d"),
  clearSubFilter3d: document.getElementById("clearSubFilter3d"),
  subFilterMeta3d: document.getElementById("subFilterMeta3d"),
  reset3dView: document.getElementById("reset3dView"),
  plotGrid3d: document.getElementById("plotGrid3d"),
};

let renderDebounceTimer = null;
let renderFrameToken = null;
let draw2dDebounceTimer = null;
let draw3dDebounceTimer = null;

function requestRenderViewsInFrame() {
  if (renderFrameToken !== null) {
    return;
  }
  renderFrameToken = window.requestAnimationFrame(() => {
    renderFrameToken = null;
    renderViews();
  });
}

function scheduleRenderViews({ debounceMs = 0 } = {}) {
  if (renderDebounceTimer !== null) {
    window.clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  if (debounceMs > 0) {
    renderDebounceTimer = window.setTimeout(() => {
      renderDebounceTimer = null;
      requestRenderViewsInFrame();
    }, debounceMs);
    return;
  }
  requestRenderViewsInFrame();
}

function drawActive2DView({ debounceMs = 0 } = {}) {
  const run = () => {
    const p = getActivePlot2d();
    if (!p) return;
    drawSingle2D(p, buildViewRows());
  };
  if (draw2dDebounceTimer !== null) {
    window.clearTimeout(draw2dDebounceTimer);
    draw2dDebounceTimer = null;
  }
  if (debounceMs > 0) {
    draw2dDebounceTimer = window.setTimeout(() => {
      draw2dDebounceTimer = null;
      run();
    }, debounceMs);
    return;
  }
  run();
}

function drawActive3DView({ debounceMs = 0 } = {}) {
  const run = () => {
    const p = getActivePlot3d();
    if (!p) return;
    drawSingle3D(p, buildViewRows());
  };
  if (draw3dDebounceTimer !== null) {
    window.clearTimeout(draw3dDebounceTimer);
    draw3dDebounceTimer = null;
  }
  if (debounceMs > 0) {
    draw3dDebounceTimer = window.setTimeout(() => {
      draw3dDebounceTimer = null;
      run();
    }, debounceMs);
    return;
  }
  run();
}

function refreshCompiledFilters() {
  state.dataOps.compiledFilters = compileActiveFilters(state.columns, state.dataOps.filters);
}

function getActivePlot2d() {
  return state.plots2d.items.find((p) => p.id === state.plots2d.activeId) || state.plots2d.items[0] || null;
}

function getActivePlot3d() {
  return state.plots3d.items.find((p) => p.id === state.plots3d.activeId) || state.plots3d.items[0] || null;
}

function createPlot2dConfig(id) {
  const numericColumns = getVisibleColumns().filter((c) => c.type === "number");
  return {
    id,
    useIndexX: true,
    xColumn: numericColumns.length ? numericColumns[0].index : null,
    yColumns: new Set(numericColumns.slice(0, 3).map((c) => c.index)),
    style: "both",
    subFilterColumn: null,
    subFilterQuery: "",
  };
}

function createPlot3dConfig(id) {
  const numericColumns = getVisibleColumns().filter((c) => c.type === "number");
  return {
    id,
    xColumn: numericColumns[0] ? numericColumns[0].index : null,
    yColumn: numericColumns[1] ? numericColumns[1].index : (numericColumns[0] ? numericColumns[0].index : null),
    zColumn: numericColumns[2] ? numericColumns[2].index : (numericColumns[1] ? numericColumns[1].index : (numericColumns[0] ? numericColumns[0].index : null)),
    colorColumn: null,
    sizeColumn: null,
    baseSize: 4,
    subFilterColumn: null,
    subFilterQuery: "",
    camera: { ...DEFAULT_3D_CAMERA },
    relayoutBound: false,
  };
}

function getPlotElement(id) {
  return document.getElementById(id);
}

function getPlotLegend(id) {
  return document.getElementById(id + "-legend");
}

init();

function init() {
  bindTabControls();
  bindDropZone();
  bindExportControl();
  bindPresetControls();
  bindDataControls();
  bind2dControls();
  bind3dControls();
  bindPlotGridControls();
  refreshSelectors();
  renderViews();

  window.addEventListener("resize", () => {
    if (!window.Plotly) {
      return;
    }
    if (state.tab === "plot2d") {
      state.plots2d.items.forEach((p) => {
        const el = getPlotElement(p.id);
        if (el) window.Plotly.Plots.resize(el);
      });
    }
    if (state.tab === "plot3d") {
      state.plots3d.items.forEach((p) => {
        const el = getPlotElement(p.id);
        if (el) window.Plotly.Plots.resize(el);
      });
    }
  });
}

function bindExportControl() {
  els.exportBtn.addEventListener("click", () => {
    const visibleColumns = getVisibleColumns();
    const viewRows = getExportRowsForActiveTab();
    if (viewRows.length === 0 || visibleColumns.length === 0) {
      setStatus("No rows available to export for the current view.", "warn");
      return;
    }

    const csv = serializeRowsToCsv(visibleColumns, viewRows);
    const fileName = getExportFileName();
    downloadCsv(fileName, csv);
    setStatus(`Exported ${viewRows.length.toLocaleString()} row(s) to ${fileName}.`, "ok");
  });
}

function bindPresetControls() {
  els.configPresetSelect.addEventListener("change", () => {
    state.presets.selectedId = els.configPresetSelect.value;
    renderPresetControls();
  });

  els.applyPresetBtn.addEventListener("click", () => {
    void applySelectedPreset();
  });

  els.loadPresetsBtn.addEventListener("click", () => {
    els.presetDirectoryInput.click();
  });

  els.presetDirectoryInput.addEventListener("change", async () => {
    await loadPresetDirectory(els.presetDirectoryInput.files);
    els.presetDirectoryInput.value = "";
  });

  els.savePresetBtn.addEventListener("click", () => {
    saveCurrentPresetYaml();
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

  if (tab === "plot2d") {
    syncControlsToActivePlot2d();
  }
  if (tab === "plot3d") {
    syncControlsToActivePlot3d();
  }
  renderViews();
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
  els.columnVisibilitySearch.addEventListener("input", () => {
    state.dataOps.columnVisibilityQuery = els.columnVisibilitySearch.value;
    renderColumnVisibilityControls();
  });

  els.showAllColumnsBtn.addEventListener("click", () => {
    state.columns.forEach((column) => {
      state.dataOps.columnVisibility[column.index] = true;
    });
    applyColumnVisibilityEffects();
    refreshSelectors();
    scheduleRenderViews();
  });

  els.hideAllColumnsBtn.addEventListener("click", () => {
    state.columns.forEach((column) => {
      state.dataOps.columnVisibility[column.index] = false;
    });
    applyColumnVisibilityEffects();
    refreshSelectors();
    scheduleRenderViews();
  });

  els.columnVisibilityControls.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }
    const colIndex = valueToNullableNumber(target.dataset.colIndex);
    if (colIndex === null || !state.columns[colIndex]) {
      return;
    }
    state.dataOps.columnVisibility[colIndex] = target.checked;
    applyColumnVisibilityEffects();
    refreshSelectors();
    scheduleRenderViews();
  });

  els.sortColumnSelect.addEventListener("change", () => {
    state.dataOps.sortColumn = valueToNullableNumber(els.sortColumnSelect.value);
    scheduleRenderViews();
  });

  els.sortDirectionSelect.addEventListener("change", () => {
    state.dataOps.sortDirection = els.sortDirectionSelect.value;
    scheduleRenderViews();
  });

  els.clearSortBtn.addEventListener("click", () => {
    state.dataOps.sortColumn = null;
    state.dataOps.sortDirection = "none";
    els.sortColumnSelect.value = "";
    els.sortDirectionSelect.value = "none";
    scheduleRenderViews();
  });

  els.clearFiltersBtn.addEventListener("click", () => {
    Object.keys(state.dataOps.filters).forEach((key) => {
      state.dataOps.filters[key] = "";
    });
    els.filterControls.querySelectorAll("input[data-col-index]").forEach((input) => {
      input.value = "";
    });
    refreshCompiledFilters();
    scheduleRenderViews();
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
    refreshCompiledFilters();
    scheduleRenderViews({ debounceMs: FILTER_INPUT_DEBOUNCE_MS });
  });

  els.statsColumnSelect.addEventListener("change", () => {
    state.dataOps.statsColumn = valueToNullableNumber(els.statsColumnSelect.value);
    if (state.tab === "data") {
      renderQuickStats(buildViewRows());
      return;
    }
    scheduleRenderViews();
  });
}

function bind2dControls() {
  els.xIndexMode.addEventListener("change", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.useIndexX = els.xIndexMode.checked;
    els.xSelect2d.disabled = p.useIndexX;
    drawActive2DView();
  });

  els.xSelect2d.addEventListener("change", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.xColumn = valueToNullableNumber(els.xSelect2d.value);
    drawActive2DView();
  });

  els.plotStyle2d.addEventListener("change", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.style = els.plotStyle2d.value;
    drawActive2DView();
  });

  els.subFilterColumn2d.addEventListener("change", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.subFilterColumn = valueToNullableNumber(els.subFilterColumn2d.value);
    drawActive2DView();
  });

  els.subFilterQuery2d.addEventListener("input", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.subFilterQuery = els.subFilterQuery2d.value;
    drawActive2DView({ debounceMs: PLOT_SUBFILTER_DEBOUNCE_MS });
  });

  els.clearSubFilter2d.addEventListener("click", () => {
    const p = getActivePlot2d();
    if (!p) return;
    p.subFilterColumn = null;
    p.subFilterQuery = "";
    els.subFilterColumn2d.value = "";
    els.subFilterQuery2d.value = "";
    drawActive2DView();
  });
}

function bind3dControls() {
  els.xSelect3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.xColumn = valueToNullableNumber(els.xSelect3d.value);
    drawActive3DView();
  });

  els.ySelect3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.yColumn = valueToNullableNumber(els.ySelect3d.value);
    drawActive3DView();
  });

  els.zSelect3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.zColumn = valueToNullableNumber(els.zSelect3d.value);
    drawActive3DView();
  });

  els.colorSelect3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.colorColumn = valueToNullableNumber(els.colorSelect3d.value);
    drawActive3DView();
  });

  els.sizeSelect3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.sizeColumn = valueToNullableNumber(els.sizeSelect3d.value);
    drawActive3DView();
  });

  els.pointSize3d.addEventListener("input", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.baseSize = Number(els.pointSize3d.value);
    els.pointSizeValue3d.textContent = String(p.baseSize);
    drawActive3DView();
  });

  els.reset3dView.addEventListener("click", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.camera = { ...DEFAULT_3D_CAMERA };
    drawActive3DView();
  });

  els.subFilterColumn3d.addEventListener("change", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.subFilterColumn = valueToNullableNumber(els.subFilterColumn3d.value);
    drawActive3DView();
  });

  els.subFilterQuery3d.addEventListener("input", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.subFilterQuery = els.subFilterQuery3d.value;
    drawActive3DView({ debounceMs: PLOT_SUBFILTER_DEBOUNCE_MS });
  });

  els.clearSubFilter3d.addEventListener("click", () => {
    const p = getActivePlot3d();
    if (!p) return;
    p.subFilterColumn = null;
    p.subFilterQuery = "";
    els.subFilterColumn3d.value = "";
    els.subFilterQuery3d.value = "";
    drawActive3DView();
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
    els.savePresetName.value = sanitizeFileName(defaultPresetName());

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
  state.dataOps.compiledFilters = [];
  state.dataOps.columnVisibility = {};
  state.dataOps.columnVisibilityQuery = "";
  state.dataOps.sortColumn = null;
  state.dataOps.sortDirection = "none";
  state.dataOps.statsColumn = null;

  state.plots2d.items = [];
  state.plots2d.activeId = null;
  state.plots2d.nextId = 0;

  state.plots3d.items = [];
  state.plots3d.activeId = null;
  state.plots3d.nextId = 0;

  els.savePresetName.value = "";
}

async function loadPresetDirectory(fileList) {
  const selectedFiles = fileList ? [...fileList] : [];
  if (selectedFiles.length === 0) {
    return;
  }

  state.presets.loading = true;
  renderPresetControls();

  try {
    const yamlFiles = selectedFiles.filter((file) => YAML_EXTENSION_RE.test(file.name));

    if (yamlFiles.length === 0) {
      state.presets.entries = [];
      state.presets.selectedId = "";
      state.presets.sourceDirectory = "";
      setStatus("No .yaml/.yml files found in selected directory.", "warn");
      return;
    }

    const loadedEntries = [];
    const skippedFiles = [];

    for (const file of yamlFiles) {
      try {
        const parsed = parseYamlDocument(await file.text());
        const normalizedPreset = normalizePresetConfig(parsed);
        const id = file.webkitRelativePath || file.name;
        loadedEntries.push({
          id,
          label: id,
          preset: normalizedPreset,
        });
      } catch (error) {
        skippedFiles.push(`${file.name} (${error.message})`);
      }
    }

    loadedEntries.sort((left, right) => left.label.localeCompare(right.label));
    state.presets.entries = loadedEntries;
    state.presets.selectedId = loadedEntries[0] ? loadedEntries[0].id : "";
    state.presets.sourceDirectory = detectPresetDirectoryLabel(yamlFiles);

    if (loadedEntries.length === 0) {
      setStatus("No valid YAML presets could be parsed from selected directory.", "warn");
      return;
    }

    if (skippedFiles.length > 0) {
      const preview = skippedFiles.slice(0, 3).join(", ");
      const suffix = skippedFiles.length > 3 ? ", ..." : "";
      setStatus(
        `Loaded ${loadedEntries.length.toLocaleString()} preset(s); skipped ${skippedFiles.length.toLocaleString()} invalid file(s): ${preview}${suffix}`,
        "warn"
      );
      return;
    }

    setStatus(`Loaded ${loadedEntries.length.toLocaleString()} preset(s).`, "ok");
  } finally {
    state.presets.loading = false;
    renderPresetControls();
  }
}

function detectPresetDirectoryLabel(files) {
  if (!files || files.length === 0) {
    return "";
  }

  const sample = files.find((file) => file.webkitRelativePath) || files[0];
  const relPath = sample.webkitRelativePath || sample.name;
  const parts = relPath.split("/");
  if (parts.length > 1) {
    return parts[0];
  }
  return "";
}

function renderPresetControls() {
  const options = [];

  if (state.presets.loading) {
    options.push("<option value=''>Loading presets...</option>");
  } else if (state.presets.entries.length === 0) {
    options.push("<option value=''>No presets loaded</option>");
  } else {
    state.presets.entries.forEach((entry) => {
      options.push(`<option value="${escapeHtml(entry.id)}">${escapeHtml(getPresetLabel(entry.label))}</option>`);
    });
  }

  els.configPresetSelect.innerHTML = options.join("");
  els.configPresetSelect.disabled = state.presets.loading || state.presets.entries.length === 0;

  if (state.presets.entries.some((entry) => entry.id === state.presets.selectedId)) {
    els.configPresetSelect.value = state.presets.selectedId;
  } else {
    els.configPresetSelect.value = "";
  }

  els.applyPresetBtn.disabled =
    state.headers.length === 0 || state.presets.loading || state.presets.entries.length === 0;
  els.savePresetBtn.disabled = state.headers.length === 0;

  if (state.presets.entries.length === 0) {
    els.presetMeta.innerHTML =
      "Click <strong>Load presets</strong> and choose a directory containing .yaml/.yml files.";
    return;
  }

  const dirLabel = state.presets.sourceDirectory ? ` from <code>${escapeHtml(state.presets.sourceDirectory)}</code>` : "";
  els.presetMeta.innerHTML = `Loaded ${state.presets.entries.length.toLocaleString()} preset(s)${dirLabel}.`;
}

function getPresetLabel(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || path;
}

function parseFiltersMap(rawFilters) {
  if (!rawFilters) {
    return {};
  }

  if (Array.isArray(rawFilters)) {
    const mapped = {};
    rawFilters.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const column = String(entry.column || "").trim();
      if (!column) {
        return;
      }
      mapped[column] = String(entry.query || "");
    });
    return mapped;
  }

  if (typeof rawFilters === "object") {
    const mapped = {};
    Object.entries(rawFilters).forEach(([column, query]) => {
      const trimmed = String(column || "").trim();
      if (!trimmed) {
        return;
      }
      mapped[trimmed] = String(query ?? "");
    });
    return mapped;
  }

  return {};
}

function normalizeSinglePlot2d(plot2d) {
  const subFilter2d =
    plot2d.subFilter && typeof plot2d.subFilter === "object" && !Array.isArray(plot2d.subFilter) ? plot2d.subFilter : {};
  const style = String(plot2d.style || "both");
  return {
    useIndexX: plot2d.useIndexX === undefined ? true : Boolean(plot2d.useIndexX),
    xColumn: plot2d.xColumn === null || plot2d.xColumn === undefined ? null : String(plot2d.xColumn),
    yColumns: Array.isArray(plot2d.yColumns) ? plot2d.yColumns.map((item) => String(item)) : [],
    style: ["scatter", "line", "both"].includes(style) ? style : "both",
    subFilter: {
      column: subFilter2d.column === null || subFilter2d.column === undefined ? null : String(subFilter2d.column),
      query: String(subFilter2d.query || ""),
    },
  };
}

function normalizeSinglePlot3d(plot3d) {
  const subFilter3d =
    plot3d.subFilter && typeof plot3d.subFilter === "object" && !Array.isArray(plot3d.subFilter) ? plot3d.subFilter : {};
  return {
    xColumn: plot3d.xColumn === null || plot3d.xColumn === undefined ? null : String(plot3d.xColumn),
    yColumn: plot3d.yColumn === null || plot3d.yColumn === undefined ? null : String(plot3d.yColumn),
    zColumn: plot3d.zColumn === null || plot3d.zColumn === undefined ? null : String(plot3d.zColumn),
    colorColumn: plot3d.colorColumn === null || plot3d.colorColumn === undefined ? null : String(plot3d.colorColumn),
    sizeColumn: plot3d.sizeColumn === null || plot3d.sizeColumn === undefined ? null : String(plot3d.sizeColumn),
    baseSize: Number.isFinite(Number(plot3d.baseSize)) ? clamp(Number(plot3d.baseSize), 1, 12) : 4,
    subFilter: {
      column: subFilter3d.column === null || subFilter3d.column === undefined ? null : String(subFilter3d.column),
      query: String(subFilter3d.query || ""),
    },
  };
}

function normalizePresetConfig(rawPreset) {
  if (!rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
    throw new Error("Preset must be a YAML object.");
  }

  const data = rawPreset.data && typeof rawPreset.data === "object" && !Array.isArray(rawPreset.data) ? rawPreset.data : {};
  const sort = data.sort && typeof data.sort === "object" && !Array.isArray(data.sort) ? data.sort : {};
  const sortDirection = String(sort.direction || "none");

  const normalizedData = {
    filters: parseFiltersMap(data.filters),
    visibleColumns: Array.isArray(data.visibleColumns) ? data.visibleColumns.map((item) => String(item)) : null,
    sort: {
      column: sort.column === null || sort.column === undefined ? null : String(sort.column),
      direction: ["none", "asc", "desc"].includes(sortDirection) ? sortDirection : "none",
    },
    statsColumn: data.statsColumn === null || data.statsColumn === undefined ? null : String(data.statsColumn),
  };

  let plots2d;
  if (Array.isArray(rawPreset.plots2d)) {
    plots2d = rawPreset.plots2d.map((item) => {
      const obj = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return normalizeSinglePlot2d(obj);
    });
  } else {
    const plot2d =
      rawPreset.plot2d && typeof rawPreset.plot2d === "object" && !Array.isArray(rawPreset.plot2d) ? rawPreset.plot2d : {};
    plots2d = [normalizeSinglePlot2d(plot2d)];
  }

  let plots3d;
  if (Array.isArray(rawPreset.plots3d)) {
    plots3d = rawPreset.plots3d.map((item) => {
      const obj = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return normalizeSinglePlot3d(obj);
    });
  } else {
    const plot3d =
      rawPreset.plot3d && typeof rawPreset.plot3d === "object" && !Array.isArray(rawPreset.plot3d) ? rawPreset.plot3d : {};
    plots3d = [normalizeSinglePlot3d(plot3d)];
  }

  return {
    version: Number.isFinite(Number(rawPreset.version)) ? Number(rawPreset.version) : 1,
    name: String(rawPreset.name || ""),
    data: normalizedData,
    plots2d,
    plots3d,
  };
}

function resolveColumnIndexByName(columnName, missingColumns) {
  if (columnName === null || columnName === undefined) {
    return null;
  }

  const name = String(columnName).trim();
  if (!name) {
    return null;
  }

  let match = state.columns.find((column) => column.name === name);
  if (!match) {
    const lower = name.toLowerCase();
    match = state.columns.find((column) => column.name.toLowerCase() === lower);
  }

  if (!match) {
    missingColumns.add(name);
    return null;
  }

  return match.index;
}

function resolveNumericColumnIndexByName(columnName, missingColumns) {
  const index = resolveColumnIndexByName(columnName, missingColumns);
  if (index === null) {
    return null;
  }

  if (state.columns[index].type !== "number") {
    missingColumns.add(String(columnName));
    return null;
  }

  return index;
}

function applyPresetConfig(preset) {
  initializeDataOps();

  const missingColumns = new Set();
  Object.keys(state.dataOps.filters).forEach((key) => {
    state.dataOps.filters[key] = "";
  });

  Object.entries(preset.data.filters).forEach(([columnName, query]) => {
    const index = resolveColumnIndexByName(columnName, missingColumns);
    if (index === null) {
      return;
    }
    state.dataOps.filters[index] = String(query || "");
  });

  if (Array.isArray(preset.data.visibleColumns)) {
    Object.keys(state.dataOps.columnVisibility).forEach((key) => {
      state.dataOps.columnVisibility[key] = false;
    });
    preset.data.visibleColumns.forEach((columnName) => {
      const index = resolveColumnIndexByName(columnName, missingColumns);
      if (index !== null) {
        state.dataOps.columnVisibility[index] = true;
      }
    });
  }

  state.dataOps.sortDirection = preset.data.sort.direction;
  state.dataOps.sortColumn = resolveColumnIndexByName(preset.data.sort.column, missingColumns);
  if (state.dataOps.sortColumn === null) {
    state.dataOps.sortDirection = "none";
  }

  const statsColumn = resolveColumnIndexByName(preset.data.statsColumn, missingColumns);
  if (statsColumn !== null) {
    state.dataOps.statsColumn = statsColumn;
  }

  state.plots2d.items = preset.plots2d.map((presetPlot, index) => {
    const id = `plot2d-${index}`;
    const cfg = createPlot2dConfig(id);
    cfg.useIndexX = presetPlot.useIndexX;
    cfg.style = presetPlot.style;
    cfg.xColumn = resolveNumericColumnIndexByName(presetPlot.xColumn, missingColumns);
    cfg.yColumns = new Set();
    presetPlot.yColumns.forEach((columnName) => {
      const colIndex = resolveNumericColumnIndexByName(columnName, missingColumns);
      if (colIndex !== null) {
        cfg.yColumns.add(colIndex);
      }
    });
    cfg.subFilterColumn = resolveColumnIndexByName(presetPlot.subFilter.column, missingColumns);
    cfg.subFilterQuery = presetPlot.subFilter.query;
    return cfg;
  });
  state.plots2d.nextId = state.plots2d.items.length;
  state.plots2d.activeId = state.plots2d.items.length > 0 ? state.plots2d.items[0].id : null;

  state.plots3d.items = preset.plots3d.map((presetPlot, index) => {
    const id = `plot3d-${index}`;
    const cfg = createPlot3dConfig(id);
    cfg.xColumn = resolveNumericColumnIndexByName(presetPlot.xColumn, missingColumns);
    cfg.yColumn = resolveNumericColumnIndexByName(presetPlot.yColumn, missingColumns);
    cfg.zColumn = resolveNumericColumnIndexByName(presetPlot.zColumn, missingColumns);
    cfg.colorColumn = resolveNumericColumnIndexByName(presetPlot.colorColumn, missingColumns);
    cfg.sizeColumn = resolveNumericColumnIndexByName(presetPlot.sizeColumn, missingColumns);
    cfg.baseSize = clamp(presetPlot.baseSize, 1, 12);
    cfg.subFilterColumn = resolveColumnIndexByName(presetPlot.subFilter.column, missingColumns);
    cfg.subFilterQuery = presetPlot.subFilter.query;
    return cfg;
  });
  state.plots3d.nextId = state.plots3d.items.length;
  state.plots3d.activeId = state.plots3d.items.length > 0 ? state.plots3d.items[0].id : null;

  applyColumnVisibilityEffects();

  return [...missingColumns];
}

function buildCurrentPresetConfig() {
  const filters = {};
  Object.entries(state.dataOps.filters).forEach(([indexText, query]) => {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return;
    }

    const index = Number(indexText);
    if (!state.headers[index]) {
      return;
    }
    filters[state.headers[index]] = trimmed;
  });

  const visibleColumns = getVisibleColumns()
    .sort((left, right) => left.index - right.index)
    .map((column) => column.name);

  const plots2d = state.plots2d.items.map((p) => {
    const yColumns = [...p.yColumns]
      .sort((left, right) => left - right)
      .map((index) => state.headers[index])
      .filter((name) => Boolean(name));
    return {
      useIndexX: p.useIndexX,
      xColumn: p.xColumn === null ? null : state.headers[p.xColumn] || null,
      yColumns,
      style: p.style,
      subFilter: {
        column: p.subFilterColumn === null ? null : state.headers[p.subFilterColumn] || null,
        query: p.subFilterQuery,
      },
    };
  });

  const plots3d = state.plots3d.items.map((p) => ({
    xColumn: p.xColumn === null ? null : state.headers[p.xColumn] || null,
    yColumn: p.yColumn === null ? null : state.headers[p.yColumn] || null,
    zColumn: p.zColumn === null ? null : state.headers[p.zColumn] || null,
    colorColumn: p.colorColumn === null ? null : state.headers[p.colorColumn] || null,
    sizeColumn: p.sizeColumn === null ? null : state.headers[p.sizeColumn] || null,
    baseSize: p.baseSize,
    subFilter: {
      column: p.subFilterColumn === null ? null : state.headers[p.subFilterColumn] || null,
      query: p.subFilterQuery,
    },
  }));

  return {
    version: 2,
    name: String(els.savePresetName.value || "").trim() || defaultPresetName(),
    data: {
      filters,
      visibleColumns,
      sort: {
        column: state.dataOps.sortColumn === null ? null : state.headers[state.dataOps.sortColumn] || null,
        direction: state.dataOps.sortDirection,
      },
      statsColumn: state.dataOps.statsColumn === null ? null : state.headers[state.dataOps.statsColumn] || null,
    },
    plots2d,
    plots3d,
  };
}

function defaultPresetName() {
  const base = (state.fileName || "preset").replace(/\\.csv$/i, "");
  return `${base}-view`;
}

function sanitizeFileName(name) {
  const trimmed = String(name || "").trim();
  const normalized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "preset";
}

async function applySelectedPreset() {
  if (state.headers.length === 0) {
    setStatus("Load a CSV before applying a preset.", "warn");
    return;
  }

  const selectedEntry = state.presets.entries.find((entry) => entry.id === state.presets.selectedId);
  if (!selectedEntry) {
    setStatus("Select a preset first.", "warn");
    return;
  }

  try {
    const preset = selectedEntry.preset;
    const missingColumns = applyPresetConfig(preset);

    refreshSelectors();
    renderViews();

    const displayName = preset.name || getPresetLabel(selectedEntry.label).replace(/\\.ya?ml$/i, "");
    if (missingColumns.length > 0) {
      const preview = missingColumns.slice(0, 6).join(", ");
      const suffix = missingColumns.length > 6 ? ", ..." : "";
      setStatus(
        `Applied preset '${displayName}' with ${missingColumns.length.toLocaleString()} missing column mapping(s): ${preview}${suffix}`,
        "warn"
      );
      return;
    }

    setStatus(`Applied preset '${displayName}'.`, "ok");
  } catch (error) {
    setStatus(`Could not apply preset: ${error.message}`, "error");
  }
}

function saveCurrentPresetYaml() {
  if (state.headers.length === 0) {
    setStatus("Load a CSV before saving a preset.", "warn");
    return;
  }

  const preset = buildCurrentPresetConfig();
  const fileName = `${sanitizeFileName(els.savePresetName.value || preset.name)}.yaml`;
  const yaml = stringifyYamlDocument(preset);

  downloadText(fileName, yaml, "application/x-yaml;charset=utf-8");
  setStatus(`Downloaded preset ${fileName}.`, "ok");
}

function initializeDataOps() {
  const filters = {};
  const columnVisibility = {};
  state.headers.forEach((_, index) => {
    filters[index] = "";
    columnVisibility[index] = true;
  });
  state.dataOps.filters = filters;
  state.dataOps.compiledFilters = [];
  state.dataOps.columnVisibility = columnVisibility;
  state.dataOps.columnVisibilityQuery = "";
  state.dataOps.sortColumn = null;
  state.dataOps.sortDirection = "none";

  const firstNumeric = state.columns.find((column) => column.type === "number");
  state.dataOps.statsColumn = firstNumeric ? firstNumeric.index : state.headers.length ? 0 : null;
  refreshCompiledFilters();
}

function initializePlotSelections() {
  const id2d = "plot2d-0";
  state.plots2d.items = [createPlot2dConfig(id2d)];
  state.plots2d.activeId = id2d;
  state.plots2d.nextId = 1;

  const id3d = "plot3d-0";
  state.plots3d.items = [createPlot3dConfig(id3d)];
  state.plots3d.activeId = id3d;
  state.plots3d.nextId = 1;
}

function isColumnVisible(index) {
  return state.dataOps.columnVisibility[index] !== false;
}

function getVisibleColumns() {
  return state.columns.filter((column) => isColumnVisible(column.index));
}

function applyColumnVisibilityEffects() {
  const visibleColumns = getVisibleColumns();
  const visibleIndexSet = new Set(visibleColumns.map((column) => column.index));
  const visibleNumeric = visibleColumns.filter((column) => column.type === "number");

  Object.keys(state.dataOps.filters).forEach((key) => {
    const index = Number(key);
    if (!visibleIndexSet.has(index)) {
      state.dataOps.filters[key] = "";
    }
  });

  if (state.dataOps.sortColumn !== null && !visibleIndexSet.has(state.dataOps.sortColumn)) {
    state.dataOps.sortColumn = null;
    state.dataOps.sortDirection = "none";
  }

  if (state.dataOps.statsColumn !== null && !visibleIndexSet.has(state.dataOps.statsColumn)) {
    state.dataOps.statsColumn = visibleColumns[0] ? visibleColumns[0].index : null;
  }

  state.plots2d.items.forEach((p) => {
    if (p.subFilterColumn !== null && !visibleIndexSet.has(p.subFilterColumn)) {
      p.subFilterColumn = null;
      p.subFilterQuery = "";
    }
    if (p.xColumn !== null && !visibleIndexSet.has(p.xColumn)) {
      p.xColumn = visibleNumeric[0] ? visibleNumeric[0].index : null;
    }
    p.yColumns = new Set(
      [...p.yColumns].filter(
        (index) => visibleIndexSet.has(index) && state.columns[index] && state.columns[index].type === "number"
      )
    );
  });

  const fallback3dX = visibleNumeric[0] ? visibleNumeric[0].index : null;
  const fallback3dY = visibleNumeric[1] ? visibleNumeric[1].index : fallback3dX;
  const fallback3dZ = visibleNumeric[2] ? visibleNumeric[2].index : fallback3dY;

  state.plots3d.items.forEach((p) => {
    if (p.subFilterColumn !== null && !visibleIndexSet.has(p.subFilterColumn)) {
      p.subFilterColumn = null;
      p.subFilterQuery = "";
    }
    if (p.xColumn === null || !visibleIndexSet.has(p.xColumn)) {
      p.xColumn = fallback3dX;
    }
    if (p.yColumn === null || !visibleIndexSet.has(p.yColumn)) {
      p.yColumn = fallback3dY;
    }
    if (p.zColumn === null || !visibleIndexSet.has(p.zColumn)) {
      p.zColumn = fallback3dZ;
    }
    if (p.colorColumn !== null && !visibleIndexSet.has(p.colorColumn)) {
      p.colorColumn = null;
    }
    if (p.sizeColumn !== null && !visibleIndexSet.has(p.sizeColumn)) {
      p.sizeColumn = null;
    }
  });

  refreshCompiledFilters();
}

function refreshSelectors() {
  renderPresetControls();
  renderDataControls();
  renderPlotGrid2d();
  renderPlotGrid3d();
  syncControlsToActivePlot2d();
  syncControlsToActivePlot3d();
}

function renderDataControls() {
  renderColumnVisibilityControls();
  renderSortControls();
  renderFilterControls();
  renderStatsControls();
}

function renderColumnVisibilityControls() {
  const total = state.columns.length;
  if (total === 0) {
    els.columnVisibilitySearch.value = "";
    els.columnVisibilitySearch.disabled = true;
    els.showAllColumnsBtn.disabled = true;
    els.hideAllColumnsBtn.disabled = true;
    els.columnVisibilityMeta.textContent = "No columns loaded.";
    els.columnVisibilityControls.innerHTML = "<div class='muted'>No columns loaded.</div>";
    return;
  }

  const query = String(state.dataOps.columnVisibilityQuery || "").trim().toLowerCase();
  const visibleCount = state.columns.filter((column) => isColumnVisible(column.index)).length;
  const filteredColumns = state.columns.filter((column) => column.name.toLowerCase().includes(query));

  els.columnVisibilitySearch.disabled = false;
  els.columnVisibilitySearch.value = state.dataOps.columnVisibilityQuery;
  els.showAllColumnsBtn.disabled = visibleCount === total;
  els.hideAllColumnsBtn.disabled = visibleCount === 0;

  const countLabel = `${visibleCount.toLocaleString()} of ${total.toLocaleString()} visible`;
  if (filteredColumns.length === 0) {
    els.columnVisibilityMeta.textContent = `${countLabel} · no columns match search`;
    els.columnVisibilityControls.innerHTML = "<div class='muted'>No matching columns.</div>";
    return;
  }

  els.columnVisibilityMeta.textContent = countLabel;
  els.columnVisibilityControls.innerHTML = filteredColumns
    .map((column) => {
      const checked = isColumnVisible(column.index) ? "checked" : "";
      return `
        <label class="checklist-item" title="${escapeHtml(column.name)}">
          <input id="visibility-col-${column.index}" type="checkbox" data-col-index="${column.index}" ${checked} />
          <span>${escapeHtml(column.name)} <span class="muted">(${column.type})</span></span>
        </label>
      `;
    })
    .join("");
}

function syncControlsToActivePlot2d() {
  const visibleColumns = getVisibleColumns();
  const numericColumns = visibleColumns.filter((c) => c.type === "number");
  const p = getActivePlot2d();

  populateSelect(els.xSelect2d, numericColumns, p ? p.xColumn : null);
  els.xIndexMode.checked = p ? p.useIndexX : true;
  els.xSelect2d.disabled = (p ? p.useIndexX : true) || numericColumns.length === 0;
  els.plotStyle2d.value = p ? p.style : "both";

  if (numericColumns.length === 0) {
    els.yColumns2d.innerHTML = "<div class='muted'>No numeric columns detected.</div>";
    return;
  }

  const selected = p ? new Set(p.yColumns) : new Set();
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
      const active = getActivePlot2d();
      if (!active) return;
      const col = Number(checkbox.dataset.colIndex);
      if (checkbox.checked) {
        active.yColumns.add(col);
      } else {
        active.yColumns.delete(col);
      }
      drawActive2DView();
    });
  });

  populateColumnSelectWithNone(els.subFilterColumn2d, visibleColumns, p ? p.subFilterColumn : null);
  els.subFilterQuery2d.value = p ? p.subFilterQuery : "";
  const disabled2d = visibleColumns.length === 0;
  els.subFilterQuery2d.disabled = disabled2d;
  els.clearSubFilter2d.disabled = disabled2d;
  if (disabled2d) els.subFilterMeta2d.textContent = "";
}

function syncControlsToActivePlot3d() {
  const visibleColumns = getVisibleColumns();
  const numericColumns = visibleColumns.filter((c) => c.type === "number");
  const p = getActivePlot3d();

  populateSelect(els.xSelect3d, numericColumns, p ? p.xColumn : null);
  populateSelect(els.ySelect3d, numericColumns, p ? p.yColumn : null);
  populateSelect(els.zSelect3d, numericColumns, p ? p.zColumn : null);
  populateOptionalSelect(els.colorSelect3d, numericColumns, p ? p.colorColumn : null);
  populateOptionalSelect(els.sizeSelect3d, numericColumns, p ? p.sizeColumn : null);

  const baseSize = p ? p.baseSize : 4;
  els.pointSize3d.value = String(baseSize);
  els.pointSizeValue3d.textContent = String(baseSize);

  populateColumnSelectWithNone(els.subFilterColumn3d, visibleColumns, p ? p.subFilterColumn : null);
  els.subFilterQuery3d.value = p ? p.subFilterQuery : "";
  const disabled3d = visibleColumns.length === 0;
  els.subFilterQuery3d.disabled = disabled3d;
  els.clearSubFilter3d.disabled = disabled3d;
  if (disabled3d) els.subFilterMeta3d.textContent = "";
}

function renderSortControls() {
  const visibleColumns = getVisibleColumns();
  if (visibleColumns.length === 0) {
    els.sortColumnSelect.innerHTML = "<option value=''>None</option>";
    els.sortColumnSelect.disabled = true;
    els.sortDirectionSelect.value = "none";
    els.sortDirectionSelect.disabled = true;
    els.clearSortBtn.disabled = true;
    return;
  }

  const options = ["<option value=''>None</option>"];
  visibleColumns.forEach((column) => {
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
  const visibleColumns = getVisibleColumns();
  if (visibleColumns.length === 0) {
    els.filterControls.innerHTML = "<div class='muted'>No columns loaded.</div>";
    els.clearFiltersBtn.disabled = true;
    return;
  }

  const html = visibleColumns
    .map((column) => {
      const placeholder = column.type === "number" ? "comma list: 1,2 or >1,<3" : "comma list: b1,b2";
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
  const visibleColumns = getVisibleColumns();
  if (visibleColumns.length === 0) {
    els.statsColumnSelect.innerHTML = "<option value=''>None</option>";
    els.statsColumnSelect.disabled = true;
    state.dataOps.statsColumn = null;
    return;
  }

  els.statsColumnSelect.innerHTML = visibleColumns
    .map((column) => `<option value="${column.index}">${escapeHtml(column.name)} (${column.type})</option>`)
    .join("");

  if (
    state.dataOps.statsColumn === null ||
    !state.columns[state.dataOps.statsColumn] ||
    !isColumnVisible(state.dataOps.statsColumn)
  ) {
    state.dataOps.statsColumn = visibleColumns[0].index;
  }

  els.statsColumnSelect.disabled = false;
  els.statsColumnSelect.value = String(state.dataOps.statsColumn);
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

function populateColumnSelectWithNone(selectEl, columns, selectedValue) {
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
  updateExportButtonState(viewRows);

  if (state.tab === "plot2d") {
    drawAll2D(viewRows);
    return;
  }

  if (state.tab === "plot3d") {
    drawAll3D(viewRows);
    return;
  }

  renderTable(viewRows);
  renderQuickStats(viewRows);
}

function updateExportButtonState(viewRows) {
  const exportRows = getExportRowsForActiveTab(viewRows);
  els.exportBtn.disabled = getVisibleColumns().length === 0 || exportRows.length === 0;
}

function buildViewRows() {
  return buildViewRowsForOps({
    rows: state.rows,
    columns: state.columns,
    filters: state.dataOps.filters,
    compiledFilters: state.dataOps.compiledFilters,
    sortColumn: state.dataOps.sortColumn,
    sortDirection: state.dataOps.sortDirection,
  });
}

function computeTableRowLimit(visibleColumnCount) {
  if (visibleColumnCount <= 0) {
    return 0;
  }
  const budgetRows = Math.floor(MAX_TABLE_RENDER_CELLS / visibleColumnCount);
  return clamp(budgetRows, MIN_TABLE_ROWS, MAX_TABLE_ROWS);
}

function renderTable(viewRows) {
  const visibleColumns = getVisibleColumns();
  if (state.headers.length === 0 || visibleColumns.length === 0) {
    els.tableContainer.classList.add("empty");
    els.tableContainer.innerHTML =
      state.headers.length === 0
        ? '<div class="empty-message">Load a CSV to view rows and columns.</div>'
        : '<div class="empty-message">No visible columns. Use Columns controls to show columns.</div>';
    els.tableMeta.textContent = "";
    return;
  }

  els.tableContainer.classList.remove("empty");

  const rowLimit = computeTableRowLimit(visibleColumns.length);
  const shown = viewRows.slice(0, rowLimit);
  const renderedCellCount = shown.length * visibleColumns.length;
  const includeCellTooltips = renderedCellCount <= MAX_CELL_TOOLTIP_CELLS;
  const headerCells = visibleColumns
    .map((column) => {
      const header = column.name;
      const index = column.index;
      const sortIndicator =
        state.dataOps.sortColumn === index
          ? state.dataOps.sortDirection === "desc"
            ? "▼"
            : state.dataOps.sortDirection === "asc"
              ? "▲"
              : ""
          : "";

      return `<th><div class="header-cell"><div class="header-main"><span class="header-name">${escapeHtml(
        header
      )}</span><span class="sort-indicator">${sortIndicator}</span></div><span class="header-type ${column.type}" title="${column.type}">${column.type}</span></div></th>`;
    })
    .join("");

  const bodyRows = shown
    .map((entry) => {
      const cells = visibleColumns
        .map((column) => {
          const value = entry.values[column.index];
          const safe = escapeHtml(value);
          if (includeCellTooltips) {
            return `<td title="${safe}">${safe}</td>`;
          }
          return `<td>${safe}</td>`;
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

  const visibleSuffix =
    viewRows.length > rowLimit
      ? rowLimit < MAX_TABLE_ROWS
        ? ` (showing first ${rowLimit.toLocaleString()} with adaptive row limit for ${visibleColumns.length.toLocaleString()} columns)`
        : ` (showing first ${rowLimit.toLocaleString()})`
      : "";
  const filterLabel = filterCount > 0 ? ` · ${filterCount} active filter${filterCount === 1 ? "" : "s"}` : "";

  const hiddenCount = state.headers.length - visibleColumns.length;
  const visibleLabel =
    hiddenCount > 0
      ? ` · ${visibleColumns.length.toLocaleString()} visible / ${state.headers.length.toLocaleString()} total columns`
      : ` · ${state.headers.length.toLocaleString()} columns`;

  els.tableMeta.textContent = `${viewRows.length.toLocaleString()} of ${state.rows.length.toLocaleString()} rows${visibleLabel}${filterLabel}${sortLabel}${visibleSuffix}`;
}

function renderQuickStats(viewRows) {
  if (state.headers.length === 0) {
    els.quickStats.classList.add("muted");
    els.quickStats.innerHTML = "Load a CSV to compute stats.";
    return;
  }

  if (state.dataOps.statsColumn === null || !isColumnVisible(state.dataOps.statsColumn)) {
    els.quickStats.classList.add("muted");
    els.quickStats.innerHTML = "Show a column to compute stats.";
    return;
  }

  const colIndex = state.dataOps.statsColumn;
  const column = state.columns[colIndex];
  const stats = computeQuickStats(viewRows, colIndex, column.type);

  if (stats.kind === "number-empty") {
    els.quickStats.classList.add("muted");
    els.quickStats.innerHTML = "No numeric values in the current filtered view.";
    return;
  }

  if (stats.kind === "number") {
    els.quickStats.classList.remove("muted");
    els.quickStats.innerHTML = [
      statItem("Rows in view", formatInt(stats.rowsInView)),
      statItem("Non-empty", formatInt(stats.nonEmpty)),
      statItem("Missing", formatInt(stats.missing)),
      statItem("Min", formatNumber(stats.min)),
      statItem("Max", formatNumber(stats.max)),
      statItem("Mean", formatNumber(stats.mean)),
      statItem("Median", formatNumber(stats.median)),
      statItem("Std dev", formatNumber(stats.stdDev)),
    ].join("");
    return;
  }

  const topValues = stats.topValues.map((entry) => `${entry.value} (${entry.count})`).join(", ");
  els.quickStats.classList.remove("muted");
  els.quickStats.innerHTML = [
    statItem("Rows in view", formatInt(stats.rowsInView)),
    statItem("Non-empty", formatInt(stats.nonEmpty)),
    statItem("Missing", formatInt(stats.missing)),
    statItem("Unique", formatInt(stats.unique)),
    statItem("Top values", escapeHtml(topValues || "none")),
  ].join("");
}

function statItem(label, value) {
  return `<div class="stat-item"><span class="stat-key">${escapeHtml(label)}</span><span class="stat-val">${value}</span></div>`;
}

function drawAll2D(viewRows) {
  if (state.tab === "plot2d") {
    updateExportButtonState(viewRows);
  }
  state.plots2d.items.forEach((plotConfig) => drawSingle2D(plotConfig, viewRows));
}

function drawSingle2D(plotCfg, viewRows) {
  const plotEl = getPlotElement(plotCfg.id);
  const legendEl = getPlotLegend(plotCfg.id);
  if (!plotEl) return;

  if (!window.Plotly) {
    setPlotUnavailable(plotEl, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    if (legendEl) legendEl.textContent = "Plotly unavailable.";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(plotEl, "Load CSV data to render a chart.");
    if (legendEl) legendEl.textContent = "Select one or more numeric Y columns to plot.";
    return;
  }

  const yColumns = [...plotCfg.yColumns];
  if (yColumns.length === 0) {
    renderEmptyPlot(plotEl, "Select at least one numeric Y column.");
    if (legendEl) legendEl.textContent = "No Y columns selected.";
    return;
  }

  if (!plotCfg.useIndexX && plotCfg.xColumn === null) {
    renderEmptyPlot(plotEl, "Select an X column or use row index.");
    if (legendEl) legendEl.textContent = "X axis is not configured.";
    return;
  }

  const plotRows = subselectPlotRows(viewRows, plotCfg.subFilterColumn, plotCfg.subFilterQuery);

  if (plotCfg.id === state.plots2d.activeId) {
    updateSubfilterMeta(els.subFilterMeta2d, plotRows.length, viewRows.length, plotCfg.subFilterColumn, plotCfg.subFilterQuery);
  }

  if (plotRows.length === 0) {
    renderEmptyPlot(plotEl, "No rows match the current Data filter + 2D subfilter.");
    if (legendEl) legendEl.textContent = `Using 0 of ${viewRows.length.toLocaleString()} filtered rows`;
    return;
  }

  const traces = [];
  const styleMode =
    plotCfg.style === "line" ? "lines" : plotCfg.style === "scatter" ? "markers" : "lines+markers";

  yColumns.forEach((yColumn, seriesIndex) => {
    const x = [];
    const y = [];

    plotRows.forEach((entry, rowIndex) => {
      const yValue = toNumber(entry.values[yColumn]);
      if (yValue === null) {
        return;
      }

      const xValue = plotCfg.useIndexX ? rowIndex + 1 : toNumber(entry.values[plotCfg.xColumn]);
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
        size: plotCfg.style === "line" ? 0 : 5,
        color: palette[seriesIndex % palette.length],
      },
      line: {
        width: 2,
        color: palette[seriesIndex % palette.length],
      },
    });
  });

  if (traces.length === 0) {
    renderEmptyPlot(plotEl, "No numeric rows available for current selections.");
    if (legendEl) legendEl.textContent = "No plottable values were found.";
    return;
  }

  const totalPoints = traces.reduce((sum, trace) => sum + trace.x.length, 0);
  const traceType = totalPoints >= SCATTER_GL_POINT_THRESHOLD ? "scattergl" : "scatter";
  traces.forEach((trace) => {
    trace.type = traceType;
  });

  const xLabel = plotCfg.useIndexX ? "Row index" : state.headers[plotCfg.xColumn] || "X";

  window.Plotly.react(
    plotEl,
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

  const items = traces
    .map(
      (trace, idx) =>
        `<span class="legend-item"><span class="swatch" style="background:${palette[idx % palette.length]}"></span>${escapeHtml(
          trace.name
        )} (${trace.x.length.toLocaleString()})</span>`
    )
    .join("");

  if (legendEl) {
    legendEl.innerHTML = `<div>Using ${plotRows.length.toLocaleString()} of ${viewRows.length.toLocaleString()} filtered rows · ${traces.length.toLocaleString()} series · ${totalPoints.toLocaleString()} points</div><div class="legend-grid">${items}</div>`;
  }
}

function drawAll3D(viewRows) {
  if (state.tab === "plot3d") {
    updateExportButtonState(viewRows);
  }
  state.plots3d.items.forEach((plotConfig) => drawSingle3D(plotConfig, viewRows));
}

function drawSingle3D(plotCfg, viewRows) {
  const plotEl = getPlotElement(plotCfg.id);
  const legendEl = getPlotLegend(plotCfg.id);
  if (!plotEl) return;

  if (!window.Plotly) {
    setPlotUnavailable(plotEl, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    if (legendEl) legendEl.textContent = "Plotly unavailable.";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(plotEl, "Load CSV data to render a 3D view.", true);
    if (legendEl) legendEl.textContent = "Select X, Y, and Z numeric columns.";
    return;
  }

  if (plotCfg.xColumn === null || plotCfg.yColumn === null || plotCfg.zColumn === null) {
    renderEmptyPlot(plotEl, "Select numeric X, Y, and Z columns.", true);
    if (legendEl) legendEl.textContent = "3D axes are not fully configured.";
    return;
  }

  const plotRows = subselectPlotRows(viewRows, plotCfg.subFilterColumn, plotCfg.subFilterQuery);

  if (plotCfg.id === state.plots3d.activeId) {
    updateSubfilterMeta(els.subFilterMeta3d, plotRows.length, viewRows.length, plotCfg.subFilterColumn, plotCfg.subFilterQuery);
  }

  if (plotRows.length === 0) {
    renderEmptyPlot(plotEl, "No rows match the current Data filter + 3D subfilter.", true);
    if (legendEl) legendEl.textContent = `Using 0 of ${viewRows.length.toLocaleString()} filtered rows`;
    return;
  }

  const x = [];
  const y = [];
  const z = [];
  const colorRaw = [];
  const sizeRaw = [];

  const hasColor = plotCfg.colorColumn !== null;
  const hasSize = plotCfg.sizeColumn !== null;

  plotRows.forEach((entry) => {
    const xValue = toNumber(entry.values[plotCfg.xColumn]);
    const yValue = toNumber(entry.values[plotCfg.yColumn]);
    const zValue = toNumber(entry.values[plotCfg.zColumn]);

    if (xValue === null || yValue === null || zValue === null) {
      return;
    }

    x.push(xValue);
    y.push(yValue);
    z.push(zValue);

    if (hasColor) {
      colorRaw.push(toNumber(entry.values[plotCfg.colorColumn]));
    }
    if (hasSize) {
      sizeRaw.push(toNumber(entry.values[plotCfg.sizeColumn]));
    }
  });

  if (x.length === 0) {
    renderEmptyPlot(plotEl, "No numeric rows available for selected axes.", true);
    if (legendEl) legendEl.textContent = "No plottable 3D points were found.";
    return;
  }

  const marker = {
    opacity: 0.85,
    size: plotCfg.baseSize,
    color: "#0f766e",
  };

  if (hasColor) {
    const validColors = colorRaw.filter((value) => value !== null);
    if (validColors.length > 0) {
      const fallback = validColors[0];
      marker.color = colorRaw.map((value) => (value === null ? fallback : value));
      marker.colorscale = "Viridis";
      marker.colorbar = {
        title: state.headers[plotCfg.colorColumn],
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
      const base = plotCfg.baseSize;

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
      xaxis: { title: state.headers[plotCfg.xColumn], gridcolor: "#e2e8f0" },
      yaxis: { title: state.headers[plotCfg.yColumn], gridcolor: "#e2e8f0" },
      zaxis: { title: state.headers[plotCfg.zColumn], gridcolor: "#e2e8f0" },
      camera: plotCfg.camera || { ...DEFAULT_3D_CAMERA },
    },
  };

  window.Plotly.react(plotEl, [trace], layout, plotConfig());
  bind3dRelayoutHandler(plotCfg, plotEl);

  const colorLabel = plotCfg.colorColumn === null ? "none" : state.headers[plotCfg.colorColumn];
  const sizeLabel = plotCfg.sizeColumn === null ? "none" : state.headers[plotCfg.sizeColumn];

  if (legendEl) {
    legendEl.textContent = `Using ${plotRows.length.toLocaleString()} of ${viewRows.length.toLocaleString()} filtered rows · Points: ${x.length.toLocaleString()} · Axes: ${state.headers[plotCfg.xColumn]}, ${state.headers[plotCfg.yColumn]}, ${state.headers[plotCfg.zColumn]} · Color: ${colorLabel} · Size: ${sizeLabel}`;
  }
}

function bind3dRelayoutHandler(plotCfg, plotEl) {
  if (plotCfg.relayoutBound) {
    return;
  }
  if (!plotEl || typeof plotEl.on !== "function") {
    return;
  }

  plotEl.on("plotly_relayout", (eventData) => {
    if (eventData && eventData["scene.camera"]) {
      plotCfg.camera = eventData["scene.camera"];
    }
  });

  plotCfg.relayoutBound = true;
}

function renderPlotGrid2d() {
  const grid = els.plotGrid2d;
  if (!grid) return;
  const addBtn = document.getElementById("addPlot2dBtn");

  const existingSlots = grid.querySelectorAll(".plot-slot:not(.plot-slot-add)");
  const existingIds = new Set();
  existingSlots.forEach((slot) => existingIds.add(slot.dataset.plotId));

  const stateIds = new Set(state.plots2d.items.map((p) => p.id));

  existingSlots.forEach((slot) => {
    if (!stateIds.has(slot.dataset.plotId)) {
      const plotEl = getPlotElement(slot.dataset.plotId);
      if (plotEl && window.Plotly) {
        try { window.Plotly.purge(plotEl); } catch (_) {}
      }
      slot.remove();
    }
  });

  state.plots2d.items.forEach((p) => {
    if (!existingIds.has(p.id)) {
      const slot = document.createElement("div");
      slot.className = "plot-slot";
      slot.dataset.plotId = p.id;
      slot.innerHTML = `
        <button class="plot-slot-close" data-plot-id="${p.id}" title="Remove plot">&times;</button>
        <div class="canvas-card"><div id="${p.id}" class="plot-surface"></div></div>
        <div id="${p.id}-legend" class="plot-slot-legend"></div>
      `;
      slot.addEventListener("click", (e) => {
        if (e.target.closest(".plot-slot-close")) return;
        selectPlot2d(p.id);
      });
      grid.insertBefore(slot, addBtn);
    }
  });

  const hideClose = state.plots2d.items.length <= 1;
  grid.querySelectorAll(".plot-slot-close").forEach((btn) => {
    btn.classList.toggle("hidden", hideClose);
  });

  grid.querySelectorAll(".plot-slot:not(.plot-slot-add)").forEach((slot) => {
    slot.classList.toggle("active", slot.dataset.plotId === state.plots2d.activeId);
  });

  updatePlotHeight(grid, state.plots2d.items.length);
}

function renderPlotGrid3d() {
  const grid = els.plotGrid3d;
  if (!grid) return;
  const addBtn = document.getElementById("addPlot3dBtn");

  const existingSlots = grid.querySelectorAll(".plot-slot:not(.plot-slot-add)");
  const existingIds = new Set();
  existingSlots.forEach((slot) => existingIds.add(slot.dataset.plotId));

  const stateIds = new Set(state.plots3d.items.map((p) => p.id));

  existingSlots.forEach((slot) => {
    if (!stateIds.has(slot.dataset.plotId)) {
      const plotEl = getPlotElement(slot.dataset.plotId);
      if (plotEl && window.Plotly) {
        try { window.Plotly.purge(plotEl); } catch (_) {}
      }
      slot.remove();
    }
  });

  state.plots3d.items.forEach((p) => {
    if (!existingIds.has(p.id)) {
      const slot = document.createElement("div");
      slot.className = "plot-slot";
      slot.dataset.plotId = p.id;
      slot.innerHTML = `
        <button class="plot-slot-close" data-plot-id="${p.id}" title="Remove plot">&times;</button>
        <div class="canvas-card"><div id="${p.id}" class="plot-surface"></div></div>
        <div id="${p.id}-legend" class="plot-slot-legend"></div>
      `;
      slot.addEventListener("click", (e) => {
        if (e.target.closest(".plot-slot-close")) return;
        selectPlot3d(p.id);
      });
      grid.insertBefore(slot, addBtn);
    }
  });

  const hideClose = state.plots3d.items.length <= 1;
  grid.querySelectorAll(".plot-slot-close").forEach((btn) => {
    btn.classList.toggle("hidden", hideClose);
  });

  grid.querySelectorAll(".plot-slot:not(.plot-slot-add)").forEach((slot) => {
    slot.classList.toggle("active", slot.dataset.plotId === state.plots3d.activeId);
  });

  updatePlotHeight(grid, state.plots3d.items.length);
}

function updatePlotHeight(grid, count) {
  const height = count > 2 ? "clamp(260px, 40vh, 440px)" : "clamp(320px, 54vh, 620px)";
  grid.style.setProperty("--plot-height", height);
}

function selectPlot2d(id) {
  state.plots2d.activeId = id;
  const grid = els.plotGrid2d;
  if (grid) {
    grid.querySelectorAll(".plot-slot:not(.plot-slot-add)").forEach((slot) => {
      slot.classList.toggle("active", slot.dataset.plotId === id);
    });
  }
  syncControlsToActivePlot2d();
}

function selectPlot3d(id) {
  state.plots3d.activeId = id;
  const grid = els.plotGrid3d;
  if (grid) {
    grid.querySelectorAll(".plot-slot:not(.plot-slot-add)").forEach((slot) => {
      slot.classList.toggle("active", slot.dataset.plotId === id);
    });
  }
  syncControlsToActivePlot3d();
}

function removePlot2d(id) {
  if (state.plots2d.items.length <= 1) return;
  const plotEl = getPlotElement(id);
  if (plotEl && window.Plotly) {
    try { window.Plotly.purge(plotEl); } catch (_) {}
  }
  state.plots2d.items = state.plots2d.items.filter((p) => p.id !== id);
  if (state.plots2d.activeId === id) {
    state.plots2d.activeId = state.plots2d.items[0].id;
  }
  renderPlotGrid2d();
  syncControlsToActivePlot2d();
  drawAll2D(buildViewRows());
}

function removePlot3d(id) {
  if (state.plots3d.items.length <= 1) return;
  const plotEl = getPlotElement(id);
  if (plotEl && window.Plotly) {
    try { window.Plotly.purge(plotEl); } catch (_) {}
  }
  state.plots3d.items = state.plots3d.items.filter((p) => p.id !== id);
  if (state.plots3d.activeId === id) {
    state.plots3d.activeId = state.plots3d.items[0].id;
  }
  renderPlotGrid3d();
  syncControlsToActivePlot3d();
  drawAll3D(buildViewRows());
}

function bindPlotGridControls() {
  const addBtn2d = document.getElementById("addPlot2dBtn");
  if (addBtn2d) {
    addBtn2d.addEventListener("click", () => {
      const id = `plot2d-${state.plots2d.nextId++}`;
      const cfg = createPlot2dConfig(id);
      state.plots2d.items.push(cfg);
      state.plots2d.activeId = id;
      renderPlotGrid2d();
      syncControlsToActivePlot2d();
      drawSingle2D(cfg, buildViewRows());
    });
  }

  const addBtn3d = document.getElementById("addPlot3dBtn");
  if (addBtn3d) {
    addBtn3d.addEventListener("click", () => {
      const id = `plot3d-${state.plots3d.nextId++}`;
      const cfg = createPlot3dConfig(id);
      state.plots3d.items.push(cfg);
      state.plots3d.activeId = id;
      renderPlotGrid3d();
      syncControlsToActivePlot3d();
      drawSingle3D(cfg, buildViewRows());
    });
  }

  document.addEventListener("click", (e) => {
    const closeBtn = e.target.closest(".plot-slot-close");
    if (!closeBtn) return;
    const plotId = closeBtn.dataset.plotId;
    if (!plotId) return;
    if (plotId.startsWith("plot2d-")) {
      removePlot2d(plotId);
    } else if (plotId.startsWith("plot3d-")) {
      removePlot3d(plotId);
    }
  });
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

function getExportRowsForActiveTab(precomputedBaseRows) {
  const baseRows = precomputedBaseRows || buildViewRows();

  if (state.tab === "plot2d") {
    const p = getActivePlot2d();
    return p ? subselectPlotRows(baseRows, p.subFilterColumn, p.subFilterQuery) : baseRows;
  }
  if (state.tab === "plot3d") {
    const p = getActivePlot3d();
    return p ? subselectPlotRows(baseRows, p.subFilterColumn, p.subFilterQuery) : baseRows;
  }
  return baseRows;
}

function serializeRowsToCsv(columns, rowEntries) {
  const lines = [];
  lines.push(columns.map((column) => csvEscape(column.name)).join(","));
  rowEntries.forEach((entry) => {
    lines.push(columns.map((column) => csvEscape(entry.values[column.index])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function getExportFileName() {
  const base = (state.fileName || "export")
    .replace(/\.csv$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const scope = state.tab === "plot2d" ? "plot2d" : state.tab === "plot3d" ? "plot3d" : "data";
  return `${base || "export"}_${scope}_view.csv`;
}

function downloadCsv(fileName, content) {
  downloadText(fileName, content, "text/csv;charset=utf-8");
}

function downloadText(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function subselectPlotRows(baseRows, subFilterColumn, subFilterQuery) {
  const query = String(subFilterQuery || "").trim();
  if (!query || subFilterColumn === null) {
    return baseRows;
  }

  const column = state.columns[subFilterColumn];
  if (!column) {
    return baseRows;
  }

  return baseRows.filter((entry) => cellMatchesFilter(entry.values[subFilterColumn] || "", query, column.type));
}

function updateSubfilterMeta(target, selectedCount, baseCount, subFilterColumn, subFilterQuery) {
  const isSubfilterActive = subFilterColumn !== null && String(subFilterQuery || "").trim() !== "";
  if (!isSubfilterActive) {
    target.textContent = `Using all ${baseCount.toLocaleString()} rows from Data filters.`;
    return;
  }

  target.textContent = `Using ${selectedCount.toLocaleString()} of ${baseCount.toLocaleString()} rows after plot subfilter.`;
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
