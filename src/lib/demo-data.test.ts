import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS, getDemoScenario } from "./demo-data";
import { reconcileDataSets } from "./reconciliation";

describe("demo scenarios", () => {
  it("ships three runnable, deterministic reconciliation workflows", () => {
    expect(DEMO_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "customers",
      "products",
      "inventory",
    ]);
    for (const scenario of DEMO_SCENARIOS) {
      const result = reconcileDataSets(
        scenario.baseline.dataSet,
        scenario.comparison.dataSet,
        scenario.config,
      );
      expect(result.summary.totalRecords).toBeGreaterThan(0);
      expect(result.summary.changed).toBeGreaterThan(0);
    }
  });

  it("covers every review state in the customer master demo", () => {
    const scenario = getDemoScenario("customers");
    const result = reconcileDataSets(
      scenario.baseline.dataSet,
      scenario.comparison.dataSet,
      scenario.config,
    );
    expect(result.summary).toMatchObject({
      added: 1,
      removed: 1,
      changed: 2,
      unchanged: 2,
      duplicateKeys: 1,
      missingKeyRows: 1,
    });
  });

  it("uses numeric comparison for price and composite keys for inventory", () => {
    const products = getDemoScenario("products");
    const productResult = reconcileDataSets(
      products.baseline.dataSet,
      products.comparison.dataSet,
      products.config,
    );
    expect(productResult.summary).toMatchObject({
      added: 1,
      removed: 1,
      changed: 2,
      unchanged: 2,
    });

    const inventory = getDemoScenario("inventory");
    expect(inventory.config.keyMappingIds).toHaveLength(2);
    const inventoryResult = reconcileDataSets(
      inventory.baseline.dataSet,
      inventory.comparison.dataSet,
      inventory.config,
    );
    expect(inventoryResult.summary).toMatchObject({
      added: 0,
      removed: 0,
      changed: 3,
      unchanged: 2,
    });
  });
});
