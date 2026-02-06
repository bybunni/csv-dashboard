export const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseCsv(text) {
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

export function detectDelimiter(text) {
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

export function countDelimitersOutsideQuotes(line, delimiter) {
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

export function variance(values) {
  if (!values.length) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function normalizeRows(rows) {
  let maxLen = 0;
  rows.forEach((row) => {
    if (row.length > maxLen) {
      maxLen = row.length;
    }
  });

  if (maxLen === 0) {
    return { headers: [], dataRows: [] };
  }

  const headerRowCount = shouldUseTwoHeaderRows(rows, maxLen) ? 2 : 1;
  let headers = dedupeHeaders(composeHeaders(rows.slice(0, headerRowCount), maxLen));

  if (maxLen > headers.length) {
    const grown = [...headers];
    for (let index = headers.length; index < maxLen; index += 1) {
      grown.push(`Column ${index + 1}`);
    }
    headers = dedupeHeaders(grown);
  }

  const dataRows = rows.slice(headerRowCount).map((row) => {
    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) {
      normalized.push("");
    }
    return normalized;
  });

  return { headers, dataRows };
}

function shouldUseTwoHeaderRows(rows, columnCount) {
  if (rows.length < 2) {
    return false;
  }

  const first = padRow(rows[0], columnCount);
  const second = padRow(rows[1], columnCount);
  const firstProfile = profileRow(first);
  const secondProfile = profileRow(second);

  if (firstProfile.nonEmpty === 0 || secondProfile.nonEmpty === 0) {
    return false;
  }

  if (firstProfile.numericRatio > 0.2 || secondProfile.numericRatio > 0.2) {
    return false;
  }

  let complements = 0;
  for (let index = 0; index < columnCount; index += 1) {
    if (!first[index].trim() && second[index].trim()) {
      complements += 1;
    }
  }

  const firstHasDuplicates = hasNonEmptyDuplicates(first);
  const secondAddsCoverage = secondProfile.nonEmpty > firstProfile.nonEmpty;

  if (complements >= 2) {
    return true;
  }

  if (firstHasDuplicates && secondProfile.nonEmpty >= 2) {
    return true;
  }

  return secondAddsCoverage && firstProfile.nonEmpty <= Math.ceil(columnCount * 0.75);
}

function composeHeaders(headerRows, columnCount) {
  const useFillForward = headerRows.length > 1;
  const normalizedRows = headerRows.map((row) => {
    const padded = padRow(row, columnCount);
    return useFillForward ? fillForward(padded) : padded.map((cell) => String(cell || "").trim());
  });
  const headers = [];

  for (let index = 0; index < columnCount; index += 1) {
    const parts = [];

    normalizedRows.forEach((row) => {
      const value = row[index].trim();
      if (!value) {
        return;
      }
      if (parts[parts.length - 1] === value) {
        return;
      }
      parts.push(value);
    });

    headers.push(parts.length ? parts.join(" / ") : `Column ${index + 1}`);
  }

  return headers;
}

function padRow(row, length) {
  const normalized = (row || []).slice(0, length);
  while (normalized.length < length) {
    normalized.push("");
  }
  return normalized;
}

function fillForward(row) {
  const expanded = [...row];
  let last = "";
  for (let index = 0; index < expanded.length; index += 1) {
    const trimmed = expanded[index].trim();
    if (trimmed) {
      last = trimmed;
      expanded[index] = trimmed;
      continue;
    }
    expanded[index] = last;
  }
  return expanded;
}

function profileRow(row) {
  let nonEmpty = 0;
  let numeric = 0;

  row.forEach((value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return;
    }
    nonEmpty += 1;
    if (toNumber(trimmed) !== null) {
      numeric += 1;
    }
  });

  return {
    nonEmpty,
    numericRatio: nonEmpty > 0 ? numeric / nonEmpty : 0,
  };
}

function hasNonEmptyDuplicates(row) {
  const seen = new Set();
  for (const value of row) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      return true;
    }
    seen.add(trimmed);
  }
  return false;
}

export function dedupeHeaders(headers) {
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

export function inferColumnTypes(headers, rows) {
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

export function toNumber(value) {
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

export function valueToNullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTick(value) {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(2);
  }
  return value.toFixed(2).replace(/\.00$/, "");
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
