import { toNumber } from "./csv-core.js";

export function buildViewRows({ rows, columns, filters, sortColumn, sortDirection }) {
  if (!rows || rows.length === 0) {
    return [];
  }

  let viewRows = rows
    .map((values, index) => ({
      values,
      sourceIndex: index + 1,
    }))
    .filter((entry) => rowMatchesFilters(entry.values, columns, filters));

  if (sortColumn !== null && sortDirection !== "none") {
    const type = columns[sortColumn]?.type || "string";
    const direction = sortDirection === "desc" ? -1 : 1;

    viewRows = viewRows.slice().sort((left, right) => {
      const leftValue = left.values[sortColumn];
      const rightValue = right.values[sortColumn];

      if (type === "number") {
        const leftNumeric = toNumber(leftValue);
        const rightNumeric = toNumber(rightValue);

        if (leftNumeric !== null && rightNumeric !== null) {
          const cmp = leftNumeric - rightNumeric;
          if (cmp !== 0) {
            return cmp * direction;
          }
        } else if (leftNumeric !== null) {
          return -1;
        } else if (rightNumeric !== null) {
          return 1;
        } else {
          const textCmp = compareCellValues(leftValue, rightValue, "string");
          if (textCmp !== 0) {
            return textCmp * direction;
          }
        }
      } else {
        const cmp = compareCellValues(leftValue, rightValue, type);
        if (cmp !== 0) {
          return cmp * direction;
        }
      }
      return left.sourceIndex - right.sourceIndex;
    });
  }

  return viewRows;
}

export function rowMatchesFilters(rowValues, columns, filters) {
  for (let index = 0; index < columns.length; index += 1) {
    const query = String(filters[index] || "").trim();
    if (!query) {
      continue;
    }

    const type = columns[index]?.type || "string";
    const cell = rowValues[index] || "";

    if (!cellMatchesFilter(cell, query, type)) {
      return false;
    }
  }
  return true;
}

export function cellMatchesFilter(cell, query, type) {
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

export function parseNumericFilter(query) {
  const raw = String(query).trim();
  if (!raw) {
    return null;
  }

  if (raw.includes("..")) {
    const parts = raw.split("..").map((part) => part.trim());
    if (parts.length !== 2) {
      return null;
    }
    if (!parts[0] || !parts[1]) {
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

export function applyNumericFilter(value, filter) {
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

export function compareCellValues(left, right, type) {
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

export function computeQuickStats(viewRows, columnIndex, columnType) {
  const values = viewRows.map((entry) => entry.values[columnIndex]);

  if (columnType === "number") {
    const numericValues = values.map((value) => toNumber(value)).filter((value) => value !== null);
    const missing = values.length - numericValues.length;

    if (numericValues.length === 0) {
      return {
        kind: "number-empty",
        rowsInView: values.length,
      };
    }

    const sorted = numericValues.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const mean = sum / sorted.length;
    const variance = sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    return {
      kind: "number",
      rowsInView: values.length,
      nonEmpty: sorted.length,
      missing,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean,
      median,
      stdDev: Math.sqrt(variance),
    };
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
    .map(([value, count]) => ({ value, count }));

  return {
    kind: "string",
    rowsInView: values.length,
    nonEmpty: present.length,
    missing,
    unique: frequencies.size,
    topValues,
  };
}
