import { describe, expect, it } from "vitest";
import {
  applyNumericFilter,
  buildViewRows,
  cellMatchesFilter,
  compareCellValues,
  computeQuickStats,
  parseNumericFilter,
  splitFilterTokens,
} from "../../web/lib/data-ops.js";

const columns = [
  { index: 0, name: "name", type: "string" },
  { index: 1, name: "value", type: "number" },
  { index: 2, name: "group", type: "string" },
];

const rows = [
  ["alice", "10", "alpha"],
  ["bob", "25", "beta"],
  ["AL", "30", "alpha"],
  ["cara", "", "gamma"],
];

describe("parseNumericFilter", () => {
  it("parses comparison and range filters", () => {
    expect(parseNumericFilter(">=10")).toEqual({ kind: "cmp", op: ">=", value: 10 });
    expect(parseNumericFilter("20..30")).toEqual({ kind: "range", min: 20, max: 30 });
    expect(parseNumericFilter("30..20")).toEqual({ kind: "range", min: 20, max: 30 });
  });

  it("returns null for invalid expressions", () => {
    expect(parseNumericFilter("..10")).toBeNull();
    expect(parseNumericFilter(">abc")).toBeNull();
    expect(parseNumericFilter("")).toBeNull();
  });
});

describe("numeric filter application", () => {
  it("applies each operator", () => {
    expect(applyNumericFilter(10, { kind: "cmp", op: ">", value: 9 })).toBe(true);
    expect(applyNumericFilter(10, { kind: "cmp", op: "<=", value: 9 })).toBe(false);
    expect(applyNumericFilter(10, { kind: "cmp", op: "!=", value: 10 })).toBe(false);
    expect(applyNumericFilter(10, { kind: "range", min: 8, max: 12 })).toBe(true);
  });
});

describe("cell matching", () => {
  it("handles case-insensitive text contains", () => {
    expect(cellMatchesFilter("Alice", "ali", "string")).toBe(true);
    expect(cellMatchesFilter("Alice", "zzz", "string")).toBe(false);
  });

  it("supports comma-separated OR matching for strings", () => {
    expect(cellMatchesFilter("b2", "b1,b2", "string")).toBe(true);
    expect(cellMatchesFilter("b3", "b1,b2", "string")).toBe(false);
  });

  it("handles numeric expressions for numeric cells", () => {
    expect(cellMatchesFilter("25", ">20", "number")).toBe(true);
    expect(cellMatchesFilter("25", "<=20", "number")).toBe(false);
  });

  it("supports compound numeric filters separated by commas", () => {
    expect(cellMatchesFilter("2", ">1,<3", "number")).toBe(true);
    expect(cellMatchesFilter("4", ">1,<3", "number")).toBe(false);
  });

  it("supports comma-separated numeric equality as OR", () => {
    expect(cellMatchesFilter("2", "1,2", "number")).toBe(true);
    expect(cellMatchesFilter("3", "1,2", "number")).toBe(false);
  });
});

describe("row building", () => {
  it("filters by text and numeric columns", () => {
    const view = buildViewRows({
      rows,
      columns,
      filters: { 0: "al", 1: ">=10", 2: "" },
      sortColumn: null,
      sortDirection: "none",
    });

    expect(view.map((entry) => entry.sourceIndex)).toEqual([1, 3]);
  });

  it("applies comma-separated numeric compound filters in row building", () => {
    const view = buildViewRows({
      rows,
      columns,
      filters: { 0: "", 1: ">10,<30", 2: "" },
      sortColumn: null,
      sortDirection: "none",
    });

    expect(view.map((entry) => entry.values[1])).toEqual(["25"]);
  });

  it("sorts numeric values and keeps stable fallback order", () => {
    const view = buildViewRows({
      rows,
      columns,
      filters: { 0: "", 1: "", 2: "" },
      sortColumn: 1,
      sortDirection: "desc",
    });

    expect(view.map((entry) => entry.values[1])).toEqual(["30", "25", "10", ""]);
  });
});

describe("value comparison", () => {
  it("compares numbers before empty numeric strings", () => {
    expect(compareCellValues("10", "", "number")).toBeLessThan(0);
    expect(compareCellValues("", "5", "number")).toBeGreaterThan(0);
  });

  it("compares strings with numeric-aware localeCompare", () => {
    expect(compareCellValues("item2", "item10", "string")).toBeLessThan(0);
  });
});

describe("quick stats", () => {
  it("computes numeric stats", () => {
    const viewRows = [
      { values: ["a", "2"] },
      { values: ["b", "4"] },
      { values: ["c", ""] },
    ];

    const stats = computeQuickStats(viewRows, 1, "number");
    expect(stats.kind).toBe("number");
    expect(stats.rowsInView).toBe(3);
    expect(stats.nonEmpty).toBe(2);
    expect(stats.missing).toBe(1);
    expect(stats.mean).toBe(3);
    expect(stats.median).toBe(3);
  });

  it("computes string stats and top values", () => {
    const viewRows = [
      { values: ["", "alpha"] },
      { values: ["", "beta"] },
      { values: ["", "alpha"] },
      { values: ["", ""] },
    ];

    const stats = computeQuickStats(viewRows, 1, "string");
    expect(stats.kind).toBe("string");
    expect(stats.rowsInView).toBe(4);
    expect(stats.nonEmpty).toBe(3);
    expect(stats.missing).toBe(1);
    expect(stats.unique).toBe(2);
    expect(stats.topValues[0]).toEqual({ value: "alpha", count: 2 });
  });
});

describe("token split", () => {
  it("splits comma lists and removes empty tokens", () => {
    expect(splitFilterTokens("a, b, ,c")).toEqual(["a", "b", "c"]);
  });
});
