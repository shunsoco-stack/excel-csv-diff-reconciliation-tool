import { describe, expect, it } from "vitest";
import { ROW_ID_KEY, type DataSet } from "./types";
import {
  createInitialConfig,
  getReconciliationConfigIssue,
  headerSimilarity,
  isLikelyKeyColumn,
  suggestColumnMappings,
} from "./mapping";

function dataSet(id: string, headers: string[]): DataSet {
  return { id, name: id, headers, rows: [{ [ROW_ID_KEY]: `${id}-1` }] };
}

describe("column mapping candidates", () => {
  it("suggests normalized column names without auto-committing them", () => {
    const baseline = dataSet("left", ["customer_id", "name"]);
    const comparison = dataSet("right", ["customerId", "name"]);
    const suggestions = suggestColumnMappings(baseline.headers, comparison.headers);
    const config = createInitialConfig(baseline, comparison);

    expect(suggestions).toContainEqual(expect.objectContaining({
      baselineColumn: "customer_id",
      comparisonColumn: "customerId",
      reason: "normalized",
    }));
    expect(config.mappings.map((mapping) => mapping.baselineColumn)).toEqual(["name"]);
  });

  it("scores close headers and identifies likely key columns", () => {
    expect(headerSimilarity("Customer Code", "customer_code")).toBeGreaterThan(0.95);
    expect(isLikelyKeyColumn("注文番号")).toBe(true);
    expect(isLikelyKeyColumn("Customer ID")).toBe(true);
    expect(isLikelyKeyColumn("備考")).toBe(false);
  });

  it("reports one centralized readiness issue for every compare entry point", () => {
    const baseline = dataSet("left", ["id", "name"]);
    const comparison = dataSet("right", ["id", "name"]);
    const initial = createInitialConfig(baseline, comparison);

    expect(getReconciliationConfigIssue(baseline, comparison, initial)).toContain(
      "照合Key",
    );
    expect(
      getReconciliationConfigIssue(baseline, comparison, {
        ...initial,
        keyMappingIds: ["mapping-1"],
        compareMappingIds: ["mapping-2"],
      }),
    ).toBeNull();
    expect(
      getReconciliationConfigIssue(baseline, comparison, {
        ...initial,
        keyMappingIds: ["mapping-1"],
        compareMappingIds: [],
      }),
    ).toBe("比較対象列を1件以上設定してください。");
  });
});
