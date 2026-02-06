const MAX_TABLE_ROWS = 2000;
const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

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
    view: {
      rotX: -0.45,
      rotY: 0.85,
      zoom: 1.15,
    },
  },
  drag3d: {
    active: false,
    lastX: 0,
    lastY: 0,
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
  xIndexMode: document.getElementById("xIndexMode"),
  xSelect2d: document.getElementById("xSelect2d"),
  plotStyle2d: document.getElementById("plotStyle2d"),
  yColumns2d: document.getElementById("yColumns2d"),
  canvas2d: document.getElementById("canvas2d"),
  legend2d: document.getElementById("legend2d"),
  xSelect3d: document.getElementById("xSelect3d"),
  ySelect3d: document.getElementById("ySelect3d"),
  zSelect3d: document.getElementById("zSelect3d"),
  colorSelect3d: document.getElementById("colorSelect3d"),
  sizeSelect3d: document.getElementById("sizeSelect3d"),
  pointSize3d: document.getElementById("pointSize3d"),
  pointSizeValue3d: document.getElementById("pointSizeValue3d"),
  reset3dView: document.getElementById("reset3dView"),
  canvas3d: document.getElementById("canvas3d"),
  meta3d: document.getElementById("meta3d"),
};

init();

function init() {
  bindTabControls();
  bindDropZone();
  bind2dControls();
  bind3dControls();
  window.addEventListener("resize", () => {
    draw2D();
    draw3D();
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
    draw2D();
  }
  if (tab === "plot3d") {
    draw3D();
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

    initializePlotSelections();
    refreshSelectors();
    renderTable();
    draw2D();
    draw3D();

    const numericCount = state.columns.filter((column) => column.type === "number").length;
    setStatus(
      `Loaded ${file.name}: ${state.rows.length.toLocaleString()} rows, ${state.headers.length.toLocaleString()} columns, delimiter '${renderDelimiter(
        state.delimiter
      )}', numeric columns ${numericCount}.`,
      "ok"
    );
  } catch (error) {
    state.fileName = "";
    state.headers = [];
    state.rows = [];
    state.columns = [];
    resetPlots();
    refreshSelectors();
    renderTable();
    draw2D();
    draw3D();
    setStatus(`Could not parse CSV: ${error.message}`, "error");
  }
}

function renderDelimiter(delimiter) {
  if (delimiter === "\t") {
    return "tab";
  }
  return delimiter;
}

function resetPlots() {
  state.plot2d.yColumns = new Set();
  state.plot2d.xColumn = null;
  state.plot3d.xColumn = null;
  state.plot3d.yColumn = null;
  state.plot3d.zColumn = null;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
}

function parseCsv(text) {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(raw);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (char === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && raw[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) {
    rows.pop();
  }

  return { delimiter, rows };
}

function detectDelimiter(text) {
  const candidates = [",", ";", "\t", "|"];
  const sampleLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (sampleLines.length === 0) {
    return ",";
  }

  let bestDelimiter = ",";
  let bestScore = -1;

  candidates.forEach((candidate) => {
    const counts = sampleLines.map((line) => countDelimitersOutsideQuotes(line, candidate));
    const total = counts.reduce((sum, count) => sum + count, 0);
    const nonZeroLines = counts.filter((count) => count > 0).length;
    const consistency = nonZeroLines > 0 ? 1 / (1 + variance(counts.filter((count) => count > 0))) : 0;
    const score = total * 0.85 + nonZeroLines * 0.1 + consistency * 0.05;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  });

  return bestDelimiter;
}

function countDelimitersOutsideQuotes(line, delimiter) {
  let inQuotes = false;
  let count = 0;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      count += 1;
    }
  }

  return count;
}

function variance(values) {
  if (!values.length) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function normalizeRows(rows) {
  const baseHeader = rows[0] || [];
  let headers = dedupeHeaders(baseHeader.map((value, index) => (value.trim() ? value.trim() : `Column ${index + 1}`)));

  let maxLen = headers.length;
  rows.slice(1).forEach((row) => {
    if (row.length > maxLen) {
      maxLen = row.length;
    }
  });

  if (maxLen > headers.length) {
    const grown = [...headers];
    for (let index = headers.length; index < maxLen; index += 1) {
      grown.push(`Column ${index + 1}`);
    }
    headers = dedupeHeaders(grown);
  }

  const dataRows = rows.slice(1).map((row) => {
    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) {
      normalized.push("");
    }
    return normalized;
  });

  return { headers, dataRows };
}

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((name) => {
    const base = name || "Column";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) {
      return base;
    }
    return `${base} (${count + 1})`;
  });
}

function inferColumnTypes(headers, rows) {
  const sampleSize = Math.min(rows.length, 2000);

  return headers.map((name, index) => {
    let numeric = 0;
    let text = 0;

    for (let i = 0; i < sampleSize; i += 1) {
      const value = (rows[i][index] || "").trim();
      if (!value) {
        continue;
      }
      if (toNumber(value) === null) {
        text += 1;
      } else {
        numeric += 1;
      }
    }

    const nonEmpty = numeric + text;
    const isNumeric = nonEmpty > 0 && numeric / nonEmpty >= 0.98;

    return {
      index,
      name,
      type: isNumeric ? "number" : "string",
      nonEmpty,
    };
  });
}

function initializePlotSelections() {
  const numericColumns = state.columns.filter((column) => column.type === "number");

  state.plot2d.useIndexX = true;
  state.plot2d.style = "both";
  state.plot2d.xColumn = numericColumns.length ? numericColumns[0].index : null;

  const defaultY = numericColumns.slice(0, 3).map((column) => column.index);
  state.plot2d.yColumns = new Set(defaultY);

  state.plot3d.xColumn = numericColumns[0] ? numericColumns[0].index : null;
  state.plot3d.yColumn = numericColumns[1] ? numericColumns[1].index : state.plot3d.xColumn;
  state.plot3d.zColumn = numericColumns[2] ? numericColumns[2].index : state.plot3d.yColumn;
  state.plot3d.colorColumn = null;
  state.plot3d.sizeColumn = null;
}

function refreshSelectors() {
  const numericColumns = state.columns.filter((column) => column.type === "number");

  render2dSelectors(numericColumns);
  render3dSelectors(numericColumns);

  els.pointSize3d.value = String(state.plot3d.baseSize);
  els.pointSizeValue3d.textContent = String(state.plot3d.baseSize);
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

  const checkboxes = els.yColumns2d.querySelectorAll("input[type='checkbox']");
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const col = Number(checkbox.dataset.colIndex);
      if (checkbox.checked) {
        state.plot2d.yColumns.add(col);
      } else {
        state.plot2d.yColumns.delete(col);
      }
      draw2D();
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

function bind2dControls() {
  els.xIndexMode.addEventListener("change", () => {
    state.plot2d.useIndexX = els.xIndexMode.checked;
    els.xSelect2d.disabled = state.plot2d.useIndexX;
    draw2D();
  });

  els.xSelect2d.addEventListener("change", () => {
    state.plot2d.xColumn = valueToNullableNumber(els.xSelect2d.value);
    draw2D();
  });

  els.plotStyle2d.addEventListener("change", () => {
    state.plot2d.style = els.plotStyle2d.value;
    draw2D();
  });
}

function bind3dControls() {
  els.xSelect3d.addEventListener("change", () => {
    state.plot3d.xColumn = valueToNullableNumber(els.xSelect3d.value);
    draw3D();
  });

  els.ySelect3d.addEventListener("change", () => {
    state.plot3d.yColumn = valueToNullableNumber(els.ySelect3d.value);
    draw3D();
  });

  els.zSelect3d.addEventListener("change", () => {
    state.plot3d.zColumn = valueToNullableNumber(els.zSelect3d.value);
    draw3D();
  });

  els.colorSelect3d.addEventListener("change", () => {
    state.plot3d.colorColumn = valueToNullableNumber(els.colorSelect3d.value);
    draw3D();
  });

  els.sizeSelect3d.addEventListener("change", () => {
    state.plot3d.sizeColumn = valueToNullableNumber(els.sizeSelect3d.value);
    draw3D();
  });

  els.pointSize3d.addEventListener("input", () => {
    state.plot3d.baseSize = Number(els.pointSize3d.value);
    els.pointSizeValue3d.textContent = String(state.plot3d.baseSize);
    draw3D();
  });

  els.reset3dView.addEventListener("click", () => {
    state.plot3d.view.rotX = -0.45;
    state.plot3d.view.rotY = 0.85;
    state.plot3d.view.zoom = 1.15;
    draw3D();
  });

  const canvas = els.canvas3d;

  canvas.addEventListener("pointerdown", (event) => {
    state.drag3d.active = true;
    state.drag3d.lastX = event.clientX;
    state.drag3d.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.drag3d.active) {
      return;
    }

    const dx = event.clientX - state.drag3d.lastX;
    const dy = event.clientY - state.drag3d.lastY;
    state.drag3d.lastX = event.clientX;
    state.drag3d.lastY = event.clientY;

    state.plot3d.view.rotY += dx * 0.01;
    state.plot3d.view.rotX += dy * 0.01;
    state.plot3d.view.rotX = clamp(state.plot3d.view.rotX, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08);
    draw3D();
  });

  canvas.addEventListener("pointerup", (event) => {
    state.drag3d.active = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerleave", () => {
    state.drag3d.active = false;
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0011);
      state.plot3d.view.zoom = clamp(state.plot3d.view.zoom * zoomFactor, 0.35, 4.5);
      draw3D();
    },
    { passive: false }
  );
}

function renderTable() {
  if (state.headers.length === 0) {
    els.tableContainer.classList.add("empty");
    els.tableContainer.innerHTML = '<div class="empty-message">Load a CSV to view rows and columns.</div>';
    els.tableMeta.textContent = "";
    return;
  }

  els.tableContainer.classList.remove("empty");

  const shown = state.rows.slice(0, MAX_TABLE_ROWS);
  const headerCells = state.headers
    .map((header, index) => {
      const column = state.columns[index];
      return `<th title="${escapeHtml(header)}"><div class="header-cell"><span>${escapeHtml(header)}</span><span class="type-chip ${column.type}">${column.type}</span></div></th>`;
    })
    .join("");

  const bodyRows = shown
    .map((row, rowIndex) => {
      const cells = row
        .map((value) => {
          const safe = escapeHtml(value);
          return `<td title="${safe}">${safe}</td>`;
        })
        .join("");
      return `<tr><th class="row-index">${(rowIndex + 1).toLocaleString()}</th>${cells}</tr>`;
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

  const suffix = state.rows.length > MAX_TABLE_ROWS ? ` (showing first ${MAX_TABLE_ROWS.toLocaleString()})` : "";
  els.tableMeta.textContent = `${state.rows.length.toLocaleString()} rows · ${state.headers.length.toLocaleString()} columns${suffix}`;
}

function draw2D() {
  const { ctx, width, height } = prepCanvas(els.canvas2d);
  paintCanvasBackground(ctx, width, height);

  if (state.rows.length === 0 || state.headers.length === 0) {
    drawCenteredMessage(ctx, width, height, "Load CSV data to render a chart.");
    els.legend2d.textContent = "Select one or more numeric Y columns to plot.";
    return;
  }

  const yColumns = [...state.plot2d.yColumns];
  if (yColumns.length === 0) {
    drawCenteredMessage(ctx, width, height, "Select at least one numeric Y column.");
    els.legend2d.textContent = "No Y columns selected.";
    return;
  }

  if (!state.plot2d.useIndexX && state.plot2d.xColumn === null) {
    drawCenteredMessage(ctx, width, height, "Select an X column or use row index.");
    els.legend2d.textContent = "X axis is not configured.";
    return;
  }

  const series = build2dSeries();
  const activeSeries = series.filter((entry) => entry.points.length > 0);

  if (activeSeries.length === 0) {
    drawCenteredMessage(ctx, width, height, "No numeric rows available for current selections.");
    els.legend2d.textContent = "No plottable values were found.";
    return;
  }

  const domain = find2dDomain(activeSeries);
  const margin = { top: 24, right: 24, bottom: 48, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  draw2dGrid(ctx, margin, plotWidth, plotHeight, domain);

  const mapX = (value) => margin.left + ((value - domain.minX) / domain.spanX) * plotWidth;
  const mapY = (value) => margin.top + (1 - (value - domain.minY) / domain.spanY) * plotHeight;

  const style = state.plot2d.style;

  activeSeries.forEach((entry, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];

    if (style === "line" || style === "both") {
      ctx.beginPath();
      entry.points.forEach((point, idx) => {
        const px = mapX(point.x);
        const py = mapY(point.y);
        if (idx === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }

    if (style === "scatter" || style === "both") {
      entry.points.forEach((point) => {
        const px = mapX(point.x);
        const py = mapY(point.y);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }
  });

  const xLabel = state.plot2d.useIndexX ? "Row index" : state.headers[state.plot2d.xColumn] || "X";
  const yLabel = activeSeries.length === 1 ? activeSeries[0].name : "Selected Y columns";

  ctx.fillStyle = "#0f172a";
  ctx.font = "600 13px IBM Plex Sans, Segoe UI, sans-serif";
  ctx.fillText(`${xLabel} vs ${yLabel}`, margin.left, 17);

  update2dLegend(activeSeries);
}

function build2dSeries() {
  const yColumns = [...state.plot2d.yColumns];
  const xColumn = state.plot2d.xColumn;

  return yColumns.map((yColumn) => {
    const points = [];

    state.rows.forEach((row, rowIndex) => {
      const yVal = toNumber(row[yColumn]);
      if (yVal === null) {
        return;
      }

      const xVal = state.plot2d.useIndexX ? rowIndex + 1 : toNumber(row[xColumn]);
      if (xVal === null) {
        return;
      }

      points.push({ x: xVal, y: yVal, row: rowIndex + 1 });
    });

    return {
      index: yColumn,
      name: state.headers[yColumn],
      points,
    };
  });
}

function find2dDomain(series) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  series.forEach((entry) => {
    entry.points.forEach((point) => {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    });
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1, spanX: 1, spanY: 1 };
  }

  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  const padX = (maxX - minX) * 0.04;
  const padY = (maxY - minY) * 0.06;

  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX: maxX - minX,
    spanY: maxY - minY,
  };
}

function draw2dGrid(ctx, margin, width, height, domain) {
  const ticks = 6;

  ctx.strokeStyle = "#dbe3ef";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "12px IBM Plex Sans, Segoe UI, sans-serif";

  for (let i = 0; i <= ticks; i += 1) {
    const t = i / ticks;
    const x = margin.left + t * width;
    const y = margin.top + t * height;

    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + width, y);
    ctx.stroke();

    const xv = domain.minX + t * domain.spanX;
    const yv = domain.maxY - t * domain.spanY;

    ctx.textAlign = "center";
    ctx.fillText(formatTick(xv), x, margin.top + height + 18);

    ctx.textAlign = "right";
    ctx.fillText(formatTick(yv), margin.left - 8, y + 4);
  }

  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(margin.left, margin.top, width, height);
}

function update2dLegend(series) {
  const totalPoints = series.reduce((sum, entry) => sum + entry.points.length, 0);

  const items = series
    .map((entry, idx) => {
      const color = palette[idx % palette.length];
      return `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${escapeHtml(
        entry.name
      )} (${entry.points.length.toLocaleString()})</span>`;
    })
    .join("");

  els.legend2d.innerHTML = `<div>${series.length.toLocaleString()} series · ${totalPoints.toLocaleString()} points</div><div class="legend-grid">${items}</div>`;
}

function draw3D() {
  const { ctx, width, height } = prepCanvas(els.canvas3d);
  paintCanvasBackground(ctx, width, height);

  if (state.rows.length === 0 || state.headers.length === 0) {
    drawCenteredMessage(ctx, width, height, "Load CSV data to render a 3D view.");
    els.meta3d.textContent = "Select X, Y, and Z numeric columns.";
    return;
  }

  if (state.plot3d.xColumn === null || state.plot3d.yColumn === null || state.plot3d.zColumn === null) {
    drawCenteredMessage(ctx, width, height, "Select numeric X, Y, and Z columns.");
    els.meta3d.textContent = "3D axes are not fully configured.";
    return;
  }

  const built = build3dPoints();

  if (built.points.length === 0) {
    drawCenteredMessage(ctx, width, height, "No numeric rows available for selected axes.");
    els.meta3d.textContent = "No plottable 3D points were found.";
    return;
  }

  const plotRect = {
    left: 50,
    top: 30,
    width: width - 100,
    height: height - 70,
  };

  const centerX = plotRect.left + plotRect.width / 2;
  const centerY = plotRect.top + plotRect.height / 2;
  const focal = Math.min(plotRect.width, plotRect.height) * 0.52 * state.plot3d.view.zoom;
  const cameraZ = 3.15;

  draw3dAxes(ctx, centerX, centerY, focal, cameraZ);

  const projected = built.points
    .map((point) => {
      const rotated = rotatePoint(point.x, point.y, point.z, state.plot3d.view.rotX, state.plot3d.view.rotY);
      const depth = cameraZ - rotated.z;
      if (depth <= 0.12) {
        return null;
      }

      const scale = focal / depth;
      return {
        sx: centerX + rotated.x * scale,
        sy: centerY - rotated.y * scale,
        depth,
        colorValue: point.colorValue,
        sizeValue: point.sizeValue,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.depth - a.depth);

  const colorDomain = built.colorDomain;
  const sizeDomain = built.sizeDomain;

  projected.forEach((point) => {
    const color = pointColor(point.colorValue, colorDomain);
    const radius = pointRadius(point.sizeValue, sizeDomain, state.plot3d.baseSize, point.depth);

    ctx.beginPath();
    ctx.arc(point.sx, point.sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = "rgba(15, 23, 42, 0.15)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  const labels = [state.headers[state.plot3d.xColumn], state.headers[state.plot3d.yColumn], state.headers[state.plot3d.zColumn]];
  const colorLabel = state.plot3d.colorColumn === null ? "none" : state.headers[state.plot3d.colorColumn];
  const sizeLabel = state.plot3d.sizeColumn === null ? "none" : state.headers[state.plot3d.sizeColumn];

  els.meta3d.textContent = `Points: ${projected.length.toLocaleString()} · Axes: ${labels.join(", ")} · Color: ${colorLabel} · Size: ${sizeLabel}`;
}

function build3dPoints() {
  const points = [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let minColor = Infinity;
  let maxColor = -Infinity;
  let minSize = Infinity;
  let maxSize = -Infinity;

  state.rows.forEach((row) => {
    const rawX = toNumber(row[state.plot3d.xColumn]);
    const rawY = toNumber(row[state.plot3d.yColumn]);
    const rawZ = toNumber(row[state.plot3d.zColumn]);

    if (rawX === null || rawY === null || rawZ === null) {
      return;
    }

    const colorValue =
      state.plot3d.colorColumn === null ? null : toNumber(row[state.plot3d.colorColumn]);
    const sizeValue = state.plot3d.sizeColumn === null ? null : toNumber(row[state.plot3d.sizeColumn]);

    if (rawX < minX) minX = rawX;
    if (rawX > maxX) maxX = rawX;
    if (rawY < minY) minY = rawY;
    if (rawY > maxY) maxY = rawY;
    if (rawZ < minZ) minZ = rawZ;
    if (rawZ > maxZ) maxZ = rawZ;

    if (colorValue !== null) {
      if (colorValue < minColor) minColor = colorValue;
      if (colorValue > maxColor) maxColor = colorValue;
    }

    if (sizeValue !== null) {
      if (sizeValue < minSize) minSize = sizeValue;
      if (sizeValue > maxSize) maxSize = sizeValue;
    }

    points.push({ rawX, rawY, rawZ, colorValue, sizeValue });
  });

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;

  const normalized = points.map((point) => ({
    x: ((point.rawX - minX) / spanX) * 2 - 1,
    y: ((point.rawY - minY) / spanY) * 2 - 1,
    z: ((point.rawZ - minZ) / spanZ) * 2 - 1,
    colorValue: point.colorValue,
    sizeValue: point.sizeValue,
  }));

  return {
    points: normalized,
    colorDomain: Number.isFinite(minColor) && Number.isFinite(maxColor) ? { min: minColor, max: maxColor } : null,
    sizeDomain: Number.isFinite(minSize) && Number.isFinite(maxSize) ? { min: minSize, max: maxSize } : null,
  };
}

function draw3dAxes(ctx, centerX, centerY, focal, cameraZ) {
  const axes = [
    { from: [-1, 0, 0], to: [1, 0, 0], color: "#dc2626", label: "X" },
    { from: [0, -1, 0], to: [0, 1, 0], color: "#16a34a", label: "Y" },
    { from: [0, 0, -1], to: [0, 0, 1], color: "#2563eb", label: "Z" },
  ];

  axes.forEach((axis) => {
    const start = projectAxisPoint(axis.from[0], axis.from[1], axis.from[2], centerX, centerY, focal, cameraZ);
    const end = projectAxisPoint(axis.to[0], axis.to[1], axis.to[2], centerX, centerY, focal, cameraZ);

    if (!start || !end) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = axis.color;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = axis.color;
    ctx.font = "700 12px IBM Plex Sans, Segoe UI, sans-serif";
    ctx.fillText(axis.label, end.x + 4, end.y - 4);
  });
}

function projectAxisPoint(x, y, z, centerX, centerY, focal, cameraZ) {
  const rotated = rotatePoint(x, y, z, state.plot3d.view.rotX, state.plot3d.view.rotY);
  const depth = cameraZ - rotated.z;
  if (depth <= 0.12) {
    return null;
  }
  const scale = focal / depth;
  return {
    x: centerX + rotated.x * scale,
    y: centerY - rotated.y * scale,
  };
}

function rotatePoint(x, y, z, rotX, rotY) {
  const cx = Math.cos(rotX);
  const sx = Math.sin(rotX);
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);

  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;

  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;

  return { x: x2, y: y1, z: z2 };
}

function pointColor(value, domain) {
  if (value === null || !domain || domain.max === domain.min) {
    return "rgba(15, 118, 110, 0.8)";
  }

  const t = clamp((value - domain.min) / (domain.max - domain.min), 0, 1);
  const hue = 216 - t * 216;
  return `hsla(${hue}, 80%, 53%, 0.84)`;
}

function pointRadius(value, domain, baseSize, depth) {
  let sizeScale = 1;
  if (value !== null && domain && domain.max !== domain.min) {
    sizeScale = 0.65 + ((value - domain.min) / (domain.max - domain.min)) * 1.6;
  }

  const perspectiveScale = clamp(2.5 / depth, 0.45, 1.8);
  return clamp(baseSize * sizeScale * perspectiveScale, 1, 18);
}

function paintCanvasBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#f8fafc");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawCenteredMessage(ctx, width, height, message) {
  ctx.fillStyle = "#64748b";
  ctx.font = "500 14px IBM Plex Sans, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "left";
}

function prepCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const displayWidth = Math.max(300, Math.floor(rect.width));
  const displayHeight = Math.max(240, Math.floor(rect.height));
  const targetWidth = Math.floor(displayWidth * pixelRatio);
  const targetHeight = Math.floor(displayHeight * pixelRatio);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  return {
    ctx,
    width: displayWidth,
    height: displayHeight,
  };
}

function setStatus(text, kind) {
  els.statusBar.textContent = text;
  els.statusBar.classList.remove("ok", "error", "warn", "muted");
  els.statusBar.classList.add(kind || "muted");
}

function toNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const compact = trimmed.replace(/,/g, "");
  if (!NUMERIC_PATTERN.test(compact)) {
    return null;
  }

  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueToNullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTick(value) {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(2);
  }
  return value.toFixed(2).replace(/\.00$/, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
