import { describe, expect, it } from "vitest";
import { ROW_ID_KEY, type DataSet } from "./types";
import {
  createTemplate,
  isTemplateCompatible,
  loadTemplates,
  persistTemplates,
  TEMPLATE_STORAGE_KEY,
} from "./template-store";

function dataSet(id: string, headers: string[]): DataSet {
  return { id, name: id, headers, rows: [{ [ROW_ID_KEY]: `${id}-1`, id: "1" }] };
}

const config = {
  version: 1 as const,
  mappings: [
    { id: "id", label: "ID", baselineColumn: "id", comparisonColumn: "customer_id" },
  ],
  keyMappingIds: ["id"],
  compareMappingIds: [],
  normalization: {
    trim: true,
    caseInsensitive: false,
    width: "none" as const,
    lineBreaks: "lf" as const,
    emptyAsNull: true,
    valueType: "text" as const,
  },
};

describe("reconciliation template store", () => {
  it("round-trips settings without source rows or file bytes", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    };
    const template = createTemplate(
      "月次顧客マスタ比較",
      dataSet("baseline", ["id"]),
      dataSet("comparison", ["customer_id"]),
      config,
      ["changed", "added"],
      new Date("2026-08-22T00:00:00.000Z"),
    );

    persistTemplates(storage, [template]);
    const loaded = loadTemplates(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].config).toEqual(config);
    expect(loaded[0].resultFilter).toEqual(["changed", "added"]);
    expect(memory.get(TEMPLATE_STORAGE_KEY)).not.toContain("baseline-1");
  });

  it("rejects unknown versions and malformed storage", () => {
    const storage = {
      getItem: () => JSON.stringify([{ version: 2, name: "future" }, null]),
      setItem: () => undefined,
    };
    expect(loadTemplates(storage)).toEqual([]);
  });

  it("checks source headers before applying a saved mapping", () => {
    const template = createTemplate(
      "顧客",
      dataSet("baseline", ["id"]),
      dataSet("comparison", ["customer_id"]),
      config,
      [],
    );
    expect(isTemplateCompatible(
      template,
      dataSet("baseline-next", ["id"]),
      dataSet("comparison-next", ["customer_id"]),
    )).toBe(true);
    expect(isTemplateCompatible(
      template,
      dataSet("baseline-next", ["id"]),
      dataSet("comparison-next", ["other"]),
    )).toBe(false);
  });
});
