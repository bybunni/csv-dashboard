import { describe, expect, it } from "vitest";
import { parseYamlDocument, stringifyYamlDocument } from "../../app-web/lib/preset-config.js";

describe("parseYamlDocument", () => {
  it("parses nested objects and arrays", () => {
    const yaml = `
version: 1
name: "Sensor focus"
data:
  filters:
    "temp_c": ">20.8"
    "site label": "a,b"
  sort:
    column: pressure_kpa
    direction: desc
  statsColumn: temp_c
plot2d:
  useIndexX: true
  yColumns:
    - temp_c
    - pressure_kpa
`;

    const parsed = parseYamlDocument(yaml);
    expect(parsed.version).toBe(1);
    expect(parsed.data.filters.temp_c).toBe(">20.8");
    expect(parsed.data.filters["site label"]).toBe("a,b");
    expect(parsed.plot2d.yColumns).toEqual(["temp_c", "pressure_kpa"]);
  });

  it("supports comments and single quotes", () => {
    const yaml = `
name: 'alpha''s preset' # inline comment
flag: true
`;

    const parsed = parseYamlDocument(yaml);
    expect(parsed.name).toBe("alpha's preset");
    expect(parsed.flag).toBe(true);
  });

  it("parses inline empty containers", () => {
    const yaml = `
filters: {}
series: []
`;

    const parsed = parseYamlDocument(yaml);
    expect(parsed.filters).toEqual({});
    expect(parsed.series).toEqual([]);
  });
});

describe("stringifyYamlDocument", () => {
  it("round-trips plain objects", () => {
    const source = {
      version: 1,
      name: "Demo",
      data: {
        filters: {
          temp_c: ">20.8",
        },
        sort: {
          column: "pressure_kpa",
          direction: "desc",
        },
        statsColumn: "temp_c",
      },
      plot2d: {
        useIndexX: true,
        yColumns: ["temp_c", "pressure_kpa"],
      },
      plot3d: {
        xColumn: "time",
        yColumn: "temp_c",
        zColumn: "pressure_kpa",
        colorColumn: null,
        sizeColumn: null,
        baseSize: 4,
      },
    };

    const yaml = stringifyYamlDocument(source);
    const parsed = parseYamlDocument(yaml);

    expect(parsed).toEqual(source);
  });
});
