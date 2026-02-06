import { describe, expect, it } from "vitest";
import {
  countDelimitersOutsideQuotes,
  dedupeHeaders,
  detectDelimiter,
  inferColumnTypes,
  normalizeRows,
  parseCsv,
  toNumber,
  valueToNullableNumber,
} from "../../app-web/lib/csv-core.js";

describe("parseCsv", () => {
  it("parses quoted fields and escaped quotes", () => {
    const csv = 'name,comment,value\nAlice,"hello, world",1\nBob,"He said ""ok""",2\n';
    const parsed = parseCsv(csv);

    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows).toEqual([
      ["name", "comment", "value"],
      ["Alice", "hello, world", "1"],
      ["Bob", 'He said "ok"', "2"],
    ]);
  });

  it("supports BOM and trims trailing empty rows", () => {
    const csv = "\ufeffa,b\n1,2\n\n";
    const parsed = parseCsv(csv);

    expect(parsed.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("delimiter detection", () => {
  it("detects semicolon-separated rows", () => {
    const csv = 'a;b;c\n1;2;3\n"4;5";6;7';
    expect(detectDelimiter(csv)).toBe(";");
  });

  it("counts delimiters outside quotes", () => {
    const line = '"left,right",center,right';
    expect(countDelimitersOutsideQuotes(line, ",")).toBe(2);
  });
});

describe("row normalization", () => {
  it("dedupes headers and pads short rows", () => {
    const rows = [
      ["time", "time", ""],
      ["1", "10", "ok", "extra"],
      ["2", "11"],
    ];

    const { headers, dataRows } = normalizeRows(rows);

    expect(headers).toEqual(["time", "time (2)", "Column 3", "Column 4"]);
    expect(dataRows).toEqual([
      ["1", "10", "ok", "extra"],
      ["2", "11", "", ""],
    ]);
  });

  it("dedupeHeaders appends counts to repeated names", () => {
    expect(dedupeHeaders(["a", "a", "a"])).toEqual(["a", "a (2)", "a (3)"]);
  });
});

describe("type inference", () => {
  it("marks columns numeric only when threshold is met", () => {
    const headers = ["id", "mixed", "label"];
    const rows = [];

    for (let i = 0; i < 50; i += 1) {
      rows.push([String(i + 1), String(i + 100), `row-${i + 1}`]);
    }
    rows[0][1] = "oops";

    const inferred = inferColumnTypes(headers, rows);

    expect(inferred.map((entry) => entry.type)).toEqual(["number", "number", "string"]);
  });
});

describe("numeric parsing helpers", () => {
  it("toNumber parses formatted numbers and rejects invalid strings", () => {
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber("2.5e3")).toBe(2500);
    expect(toNumber("not-a-number")).toBeNull();
  });

  it("valueToNullableNumber converts empty values to null", () => {
    expect(valueToNullableNumber("")).toBeNull();
    expect(valueToNullableNumber("42")).toBe(42);
  });
});
