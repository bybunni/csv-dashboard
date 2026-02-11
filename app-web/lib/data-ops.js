import { toNumber } from "./csv-core.js";

export function buildViewRows({ rows, columns, filters, sortColumn, sortDirection, compiledFilters }) {
  if (!rows || rows.length === 0) {
    return [];
  }

  const activeFilters = Array.isArray(compiledFilters) ? compiledFilters : compileActiveFilters(columns, filters);
  const viewRows = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (!rowMatchesCompiledFilters(values, activeFilters)) {
      continue;
    }
    viewRows.push({
      values,
      sourceIndex: rowIndex + 1,
    });
  }

  if (sortColumn !== null && sortDirection !== "none") {
    const type = columns[sortColumn]?.type || "string";
    const direction = sortDirection === "desc" ? -1 : 1;

    viewRows.sort((left, right) => {
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

export function compileActiveFilters(columns, filters) {
  const compiled = [];
  if (!Array.isArray(columns) || columns.length === 0) {
    return compiled;
  }

  for (let index = 0; index < columns.length; index += 1) {
    const query = String(filters?.[index] || "").trim();
    if (!query) {
      continue;
    }

    const type = columns[index]?.type || "string";
    const compiledQuery = compileFilterQuery(query, type);
    if (!compiledQuery) {
      continue;
    }

    compiled.push({
      index,
      compiledQuery,
    });
  }

  return compiled;
}

export function rowMatchesCompiledFilters(rowValues, activeFilters) {
  if (!Array.isArray(activeFilters) || activeFilters.length === 0) {
    return true;
  }

  for (let i = 0; i < activeFilters.length; i += 1) {
    const active = activeFilters[i];
    const cell = rowValues[active.index] || "";
    if (!cellMatchesCompiledFilter(cell, active.compiledQuery)) {
      return false;
    }
  }
  return true;
}

export function rowMatchesFilters(rowValues, columns, filters) {
  return rowMatchesCompiledFilters(rowValues, compileActiveFilters(columns, filters));
}

export function cellMatchesFilter(cell, query, type) {
  const compiled = compileFilterQuery(query, type);
  if (!compiled) {
    return true;
  }
  return cellMatchesCompiledFilter(cell, compiled);
}

function compileFilterQuery(query, type) {
  const tokens = splitFilterTokens(query);
  if (tokens.length === 0) {
    return null;
  }

  const compiled = {
    type,
    tokens,
    textTokens: tokens.map((token) => token.toLowerCase()),
    numericFilters: null,
    allNumericEquality: false,
  };

  if (type === "number") {
    const parsedNumericFilters = tokens.map((token) => parseNumericFilter(token));
    const allNumeric = parsedNumericFilters.every((filter) => filter !== null);
    if (allNumeric) {
      compiled.numericFilters = parsedNumericFilters;
      compiled.allNumericEquality = parsedNumericFilters.every((filter) => filter.kind === "cmp" && filter.op === "=");
    }
  }

  return compiled;
}

function cellMatchesCompiledFilter(cell, compiled) {
  const text = String(cell);

  if (compiled.numericFilters) {
    const numericValue = toNumber(text);
    if (numericValue === null) {
      return false;
    }

    if (compiled.allNumericEquality) {
      return compiled.numericFilters.some((filter) => applyNumericFilter(numericValue, filter));
    }

    return compiled.numericFilters.every((filter) => applyNumericFilter(numericValue, filter));
  }

  const normalizedText = text.toLowerCase();
  return compiled.textTokens.some((token) => normalizedText.includes(token));
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

export function splitFilterTokens(query) {
  return String(query)
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
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
