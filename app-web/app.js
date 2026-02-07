import {
  clamp,
  escapeHtml,
  inferColumnTypes,
  normalizeRows,
  parseCsv,
  toNumber,
  valueToNullableNumber,
} from "./lib/csv-core.js";
import { buildViewRows as buildViewRowsForOps, cellMatchesFilter, computeQuickStats } from "./lib/data-ops.js";
import { parseYamlDocument, stringifyYamlDocument } from "./lib/preset-config.js";

const MAX_TABLE_ROWS = 2000;
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
    columnVisibility: {},
    columnVisibilityQuery: "",
    sortColumn: null,
    sortDirection: "none",
    statsColumn: null,
  },
  plot2d: {
    useIndexX: true,
    xColumn: null,
    yColumns: new Set(),
    style: "both",
    subFilterColumn: null,
    subFilterQuery: "",
  },
  plot3d: {
    xColumn: null,
    yColumn: null,
    zColumn: null,
    colorColumn: null,
    sizeColumn: null,
    baseSize: 4,
    subFilterColumn: null,
    subFilterQuery: "",
    camera: { ...DEFAULT_3D_CAMERA },
    relayoutBound: false,
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
  plot2d: document.getElementById("plot2d"),
  legend2d: document.getElementById("legend2d"),
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
  plot3d: document.getElementById("plot3d"),
  meta3d: document.getElementById("meta3d"),
};

init();

function init() {
  bindTabControls();
  bindDropZone();
  bindExportControl();
  bindPresetControls();
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

  const viewRows = buildViewRows();
  if (tab === "plot2d") {
    draw2D(viewRows);
  }
  if (tab === "plot3d") {
    draw3D(viewRows);
  }
  updateExportButtonState(viewRows);
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
    renderViews();
  });

  els.hideAllColumnsBtn.addEventListener("click", () => {
    state.columns.forEach((column) => {
      state.dataOps.columnVisibility[column.index] = false;
    });
    applyColumnVisibilityEffects();
    refreshSelectors();
    renderViews();
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
    renderViews();
  });

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

  els.subFilterColumn2d.addEventListener("change", () => {
    state.plot2d.subFilterColumn = valueToNullableNumber(els.subFilterColumn2d.value);
    draw2D(buildViewRows());
  });

  els.subFilterQuery2d.addEventListener("input", () => {
    state.plot2d.subFilterQuery = els.subFilterQuery2d.value;
    draw2D(buildViewRows());
  });

  els.clearSubFilter2d.addEventListener("click", () => {
    state.plot2d.subFilterColumn = null;
    state.plot2d.subFilterQuery = "";
    els.subFilterColumn2d.value = "";
    els.subFilterQuery2d.value = "";
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

  els.subFilterColumn3d.addEventListener("change", () => {
    state.plot3d.subFilterColumn = valueToNullableNumber(els.subFilterColumn3d.value);
    draw3D(buildViewRows());
  });

  els.subFilterQuery3d.addEventListener("input", () => {
    state.plot3d.subFilterQuery = els.subFilterQuery3d.value;
    draw3D(buildViewRows());
  });

  els.clearSubFilter3d.addEventListener("click", () => {
    state.plot3d.subFilterColumn = null;
    state.plot3d.subFilterQuery = "";
    els.subFilterColumn3d.value = "";
    els.subFilterQuery3d.value = "";
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
  state.dataOps.columnVisibility = {};
  state.dataOps.columnVisibilityQuery = "";
  state.dataOps.sortColumn = null;
  state.dataOps.sortDirection = "none";
  state.dataOps.statsColumn = null;

  state.plot2d.yColumns = new Set();
  state.plot2d.xColumn = null;
  state.plot2d.subFilterColumn = null;
  state.plot2d.subFilterQuery = "";

  state.plot3d.xColumn = null;
  state.plot3d.yColumn = null;
  state.plot3d.zColumn = null;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
  state.plot3d.subFilterColumn = null;
  state.plot3d.subFilterQuery = "";
  state.plot3d.camera = { ...DEFAULT_3D_CAMERA };

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

function normalizePresetConfig(rawPreset) {
  if (!rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
    throw new Error("Preset must be a YAML object.");
  }

  const data = rawPreset.data && typeof rawPreset.data === "object" && !Array.isArray(rawPreset.data) ? rawPreset.data : {};
  const plot2d =
    rawPreset.plot2d && typeof rawPreset.plot2d === "object" && !Array.isArray(rawPreset.plot2d) ? rawPreset.plot2d : {};
  const plot3d =
    rawPreset.plot3d && typeof rawPreset.plot3d === "object" && !Array.isArray(rawPreset.plot3d) ? rawPreset.plot3d : {};
  const sort = data.sort && typeof data.sort === "object" && !Array.isArray(data.sort) ? data.sort : {};
  const subFilter2d =
    plot2d.subFilter && typeof plot2d.subFilter === "object" && !Array.isArray(plot2d.subFilter) ? plot2d.subFilter : {};
  const subFilter3d =
    plot3d.subFilter && typeof plot3d.subFilter === "object" && !Array.isArray(plot3d.subFilter) ? plot3d.subFilter : {};

  const style = String(plot2d.style || "both");
  const sortDirection = String(sort.direction || "none");

  return {
    version: Number.isFinite(Number(rawPreset.version)) ? Number(rawPreset.version) : 1,
    name: String(rawPreset.name || ""),
    data: {
      filters: parseFiltersMap(data.filters),
      visibleColumns: Array.isArray(data.visibleColumns) ? data.visibleColumns.map((item) => String(item)) : null,
      sort: {
        column: sort.column === null || sort.column === undefined ? null : String(sort.column),
        direction: ["none", "asc", "desc"].includes(sortDirection) ? sortDirection : "none",
      },
      statsColumn: data.statsColumn === null || data.statsColumn === undefined ? null : String(data.statsColumn),
    },
    plot2d: {
      useIndexX: plot2d.useIndexX === undefined ? true : Boolean(plot2d.useIndexX),
      xColumn: plot2d.xColumn === null || plot2d.xColumn === undefined ? null : String(plot2d.xColumn),
      yColumns: Array.isArray(plot2d.yColumns) ? plot2d.yColumns.map((item) => String(item)) : [],
      style: ["scatter", "line", "both"].includes(style) ? style : "both",
      subFilter: {
        column: subFilter2d.column === null || subFilter2d.column === undefined ? null : String(subFilter2d.column),
        query: String(subFilter2d.query || ""),
      },
    },
    plot3d: {
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
    },
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
  initializePlotSelections();

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

  state.plot2d.useIndexX = preset.plot2d.useIndexX;
  state.plot2d.style = preset.plot2d.style;
  state.plot2d.xColumn = resolveNumericColumnIndexByName(preset.plot2d.xColumn, missingColumns);
  state.plot2d.yColumns = new Set();
  preset.plot2d.yColumns.forEach((columnName) => {
    const index = resolveNumericColumnIndexByName(columnName, missingColumns);
    if (index !== null) {
      state.plot2d.yColumns.add(index);
    }
  });
  state.plot2d.subFilterColumn = resolveColumnIndexByName(preset.plot2d.subFilter.column, missingColumns);
  state.plot2d.subFilterQuery = preset.plot2d.subFilter.query;

  state.plot3d.xColumn = resolveNumericColumnIndexByName(preset.plot3d.xColumn, missingColumns);
  state.plot3d.yColumn = resolveNumericColumnIndexByName(preset.plot3d.yColumn, missingColumns);
  state.plot3d.zColumn = resolveNumericColumnIndexByName(preset.plot3d.zColumn, missingColumns);
  state.plot3d.colorColumn = resolveNumericColumnIndexByName(preset.plot3d.colorColumn, missingColumns);
  state.plot3d.sizeColumn = resolveNumericColumnIndexByName(preset.plot3d.sizeColumn, missingColumns);
  state.plot3d.baseSize = clamp(preset.plot3d.baseSize, 1, 12);
  state.plot3d.subFilterColumn = resolveColumnIndexByName(preset.plot3d.subFilter.column, missingColumns);
  state.plot3d.subFilterQuery = preset.plot3d.subFilter.query;

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

  const yColumns = [...state.plot2d.yColumns]
    .sort((left, right) => left - right)
    .map((index) => state.headers[index])
    .filter((name) => Boolean(name));

  const visibleColumns = getVisibleColumns()
    .sort((left, right) => left.index - right.index)
    .map((column) => column.name);

  return {
    version: 1,
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
    plot2d: {
      useIndexX: state.plot2d.useIndexX,
      xColumn: state.plot2d.xColumn === null ? null : state.headers[state.plot2d.xColumn] || null,
      yColumns,
      style: state.plot2d.style,
      subFilter: {
        column: state.plot2d.subFilterColumn === null ? null : state.headers[state.plot2d.subFilterColumn] || null,
        query: state.plot2d.subFilterQuery,
      },
    },
    plot3d: {
      xColumn: state.plot3d.xColumn === null ? null : state.headers[state.plot3d.xColumn] || null,
      yColumn: state.plot3d.yColumn === null ? null : state.headers[state.plot3d.yColumn] || null,
      zColumn: state.plot3d.zColumn === null ? null : state.headers[state.plot3d.zColumn] || null,
      colorColumn: state.plot3d.colorColumn === null ? null : state.headers[state.plot3d.colorColumn] || null,
      sizeColumn: state.plot3d.sizeColumn === null ? null : state.headers[state.plot3d.sizeColumn] || null,
      baseSize: state.plot3d.baseSize,
      subFilter: {
        column: state.plot3d.subFilterColumn === null ? null : state.headers[state.plot3d.subFilterColumn] || null,
        query: state.plot3d.subFilterQuery,
      },
    },
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
  state.dataOps.columnVisibility = columnVisibility;
  state.dataOps.columnVisibilityQuery = "";
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
  state.plot2d.subFilterColumn = null;
  state.plot2d.subFilterQuery = "";

  state.plot3d.xColumn = numericColumns[0] ? numericColumns[0].index : null;
  state.plot3d.yColumn = numericColumns[1] ? numericColumns[1].index : state.plot3d.xColumn;
  state.plot3d.zColumn = numericColumns[2] ? numericColumns[2].index : state.plot3d.yColumn;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
  state.plot3d.subFilterColumn = null;
  state.plot3d.subFilterQuery = "";
  state.plot3d.baseSize = 4;
  state.plot3d.camera = { ...DEFAULT_3D_CAMERA };
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

  if (state.plot2d.subFilterColumn !== null && !visibleIndexSet.has(state.plot2d.subFilterColumn)) {
    state.plot2d.subFilterColumn = null;
    state.plot2d.subFilterQuery = "";
  }

  if (state.plot3d.subFilterColumn !== null && !visibleIndexSet.has(state.plot3d.subFilterColumn)) {
    state.plot3d.subFilterColumn = null;
    state.plot3d.subFilterQuery = "";
  }

  if (state.plot2d.xColumn !== null && !visibleIndexSet.has(state.plot2d.xColumn)) {
    state.plot2d.xColumn = visibleNumeric[0] ? visibleNumeric[0].index : null;
  }

  state.plot2d.yColumns = new Set(
    [...state.plot2d.yColumns].filter(
      (index) => visibleIndexSet.has(index) && state.columns[index] && state.columns[index].type === "number"
    )
  );

  const fallback3dX = visibleNumeric[0] ? visibleNumeric[0].index : null;
  const fallback3dY = visibleNumeric[1] ? visibleNumeric[1].index : fallback3dX;
  const fallback3dZ = visibleNumeric[2] ? visibleNumeric[2].index : fallback3dY;

  if (state.plot3d.xColumn === null || !visibleIndexSet.has(state.plot3d.xColumn)) {
    state.plot3d.xColumn = fallback3dX;
  }
  if (state.plot3d.yColumn === null || !visibleIndexSet.has(state.plot3d.yColumn)) {
    state.plot3d.yColumn = fallback3dY;
  }
  if (state.plot3d.zColumn === null || !visibleIndexSet.has(state.plot3d.zColumn)) {
    state.plot3d.zColumn = fallback3dZ;
  }

  if (state.plot3d.colorColumn !== null && !visibleIndexSet.has(state.plot3d.colorColumn)) {
    state.plot3d.colorColumn = null;
  }
  if (state.plot3d.sizeColumn !== null && !visibleIndexSet.has(state.plot3d.sizeColumn)) {
    state.plot3d.sizeColumn = null;
  }
}

function refreshSelectors() {
  const visibleColumns = getVisibleColumns();
  const numericColumns = visibleColumns.filter((column) => column.type === "number");

  renderPresetControls();
  renderDataControls();
  renderPlotSubfilterControls(visibleColumns);
  render2dSelectors(numericColumns);
  render3dSelectors(numericColumns);

  els.pointSize3d.value = String(state.plot3d.baseSize);
  els.pointSizeValue3d.textContent = String(state.plot3d.baseSize);
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

function renderPlotSubfilterControls(columns) {
  populateColumnSelectWithNone(els.subFilterColumn2d, columns, state.plot2d.subFilterColumn);
  populateColumnSelectWithNone(els.subFilterColumn3d, columns, state.plot3d.subFilterColumn);

  els.subFilterQuery2d.value = state.plot2d.subFilterQuery;
  els.subFilterQuery3d.value = state.plot3d.subFilterQuery;

  const disabled = columns.length === 0;
  els.subFilterQuery2d.disabled = disabled;
  els.subFilterQuery3d.disabled = disabled;
  els.clearSubFilter2d.disabled = disabled;
  els.clearSubFilter3d.disabled = disabled;

  if (disabled) {
    els.subFilterMeta2d.textContent = "";
    els.subFilterMeta3d.textContent = "";
  }
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
  renderTable(viewRows);
  renderQuickStats(viewRows);
  draw2D(viewRows);
  draw3D(viewRows);
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
    sortColumn: state.dataOps.sortColumn,
    sortDirection: state.dataOps.sortDirection,
  });
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

  const shown = viewRows.slice(0, MAX_TABLE_ROWS);
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

      return `<th title="${escapeHtml(header)}"><div class="header-cell"><div class="header-main"><span class="header-name">${escapeHtml(
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

function draw2D(viewRows) {
  if (state.tab === "plot2d") {
    updateExportButtonState(viewRows);
  }

  if (!window.Plotly) {
    setPlotUnavailable(els.plot2d, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    els.legend2d.textContent = "Plotly unavailable.";
    els.subFilterMeta2d.textContent = "";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(els.plot2d, "Load CSV data to render a chart.");
    els.legend2d.textContent = "Select one or more numeric Y columns to plot.";
    els.subFilterMeta2d.textContent = "";
    return;
  }

  const yColumns = [...state.plot2d.yColumns];
  if (yColumns.length === 0) {
    renderEmptyPlot(els.plot2d, "Select at least one numeric Y column.");
    els.legend2d.textContent = "No Y columns selected.";
    els.subFilterMeta2d.textContent = "";
    return;
  }

  if (!state.plot2d.useIndexX && state.plot2d.xColumn === null) {
    renderEmptyPlot(els.plot2d, "Select an X column or use row index.");
    els.legend2d.textContent = "X axis is not configured.";
    els.subFilterMeta2d.textContent = "";
    return;
  }

  const plotRows = subselectPlotRows(viewRows, state.plot2d.subFilterColumn, state.plot2d.subFilterQuery);
  updateSubfilterMeta(
    els.subFilterMeta2d,
    plotRows.length,
    viewRows.length,
    state.plot2d.subFilterColumn,
    state.plot2d.subFilterQuery
  );

  if (plotRows.length === 0) {
    renderEmptyPlot(els.plot2d, "No rows match the current Data filter + 2D subfilter.");
    els.legend2d.textContent = `Using 0 of ${viewRows.length.toLocaleString()} filtered rows`;
    return;
  }

  const traces = [];
  const styleMode =
    state.plot2d.style === "line" ? "lines" : state.plot2d.style === "scatter" ? "markers" : "lines+markers";

  yColumns.forEach((yColumn, seriesIndex) => {
    const x = [];
    const y = [];

    plotRows.forEach((entry, rowIndex) => {
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

  els.legend2d.innerHTML = `<div>Using ${plotRows.length.toLocaleString()} of ${viewRows.length.toLocaleString()} filtered rows · ${traces.length.toLocaleString()} series · ${totalPoints.toLocaleString()} points</div><div class="legend-grid">${items}</div>`;
}

function draw3D(viewRows) {
  if (state.tab === "plot3d") {
    updateExportButtonState(viewRows);
  }

  if (!window.Plotly) {
    setPlotUnavailable(els.plot3d, "Plotly asset not loaded. Run npm install to provision local plotly.min.js.");
    els.meta3d.textContent = "Plotly unavailable.";
    els.subFilterMeta3d.textContent = "";
    return;
  }

  if (state.headers.length === 0) {
    renderEmptyPlot(els.plot3d, "Load CSV data to render a 3D view.", true);
    els.meta3d.textContent = "Select X, Y, and Z numeric columns.";
    els.subFilterMeta3d.textContent = "";
    return;
  }

  if (state.plot3d.xColumn === null || state.plot3d.yColumn === null || state.plot3d.zColumn === null) {
    renderEmptyPlot(els.plot3d, "Select numeric X, Y, and Z columns.", true);
    els.meta3d.textContent = "3D axes are not fully configured.";
    els.subFilterMeta3d.textContent = "";
    return;
  }

  const plotRows = subselectPlotRows(viewRows, state.plot3d.subFilterColumn, state.plot3d.subFilterQuery);
  updateSubfilterMeta(
    els.subFilterMeta3d,
    plotRows.length,
    viewRows.length,
    state.plot3d.subFilterColumn,
    state.plot3d.subFilterQuery
  );

  if (plotRows.length === 0) {
    renderEmptyPlot(els.plot3d, "No rows match the current Data filter + 3D subfilter.", true);
    els.meta3d.textContent = `Using 0 of ${viewRows.length.toLocaleString()} filtered rows`;
    return;
  }

  const x = [];
  const y = [];
  const z = [];
  const colorRaw = [];
  const sizeRaw = [];

  const hasColor = state.plot3d.colorColumn !== null;
  const hasSize = state.plot3d.sizeColumn !== null;

  plotRows.forEach((entry) => {
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

  els.meta3d.textContent = `Using ${plotRows.length.toLocaleString()} of ${viewRows.length.toLocaleString()} filtered rows · Points: ${x.length.toLocaleString()} · Axes: ${state.headers[state.plot3d.xColumn]}, ${state.headers[state.plot3d.yColumn]}, ${state.headers[state.plot3d.zColumn]} · Color: ${colorLabel} · Size: ${sizeLabel}`;
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

function getExportRowsForActiveTab(precomputedBaseRows) {
  const baseRows = precomputedBaseRows || buildViewRows();

  if (state.tab === "plot2d") {
    return subselectPlotRows(baseRows, state.plot2d.subFilterColumn, state.plot2d.subFilterQuery);
  }
  if (state.tab === "plot3d") {
    return subselectPlotRows(baseRows, state.plot3d.subFilterColumn, state.plot3d.subFilterQuery);
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
