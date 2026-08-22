import { describe, expect, it } from "vitest";
import {
  DEFAULT_NORMALIZATION_OPTIONS,
  ReconciliationConfigError,
  fullWidthToHalfWidth,
  halfWidthToFullWidth,
  normalizeCellValue,
  reconcileDataSets,
  selectReconciliationItems,
  validateReconciliationConfig,
  type ColumnMapping,
  type NormalizationOptions,
  type ReconciliationConfig,
} from "./reconciliation";
import { ROW_ID_KEY, type CellValue, type DataRow, type DataSet } from "./types";

function createDataSet(
  id: string,
  headers: string[],
  values: readonly (readonly CellValue[])[],
): DataSet {
  return {
    id,
    name: id,
    headers: [...headers],
    rows: values.map((cells, rowIndex) => {
      const row = { [ROW_ID_KEY]: `${id}-row-${rowIndex + 1}` } as DataRow;
      headers.forEach((header, columnIndex) => {
        row[header] = cells[columnIndex] ?? null;
      });
      return row;
    }),
  };
}

function normalization(
  overrides: Partial<NormalizationOptions> = {},
): NormalizationOptions {
  return { ...DEFAULT_NORMALIZATION_OPTIONS, ...overrides };
}

function simpleConfig(
  mappings: ColumnMapping[],
  keyMappingIds: string[],
  compareMappingIds: string[] = [],
  overrides: Partial<ReconciliationConfig> = {},
): ReconciliationConfig {
  return {
    version: 1,
    mappings,
    keyMappingIds,
    compareMappingIds,
    normalization: normalization(),
    ...overrides,
  };
}

describe("cell normalization", () => {
  it("normalizes trim, case, width, and line breaks without mutating the source", () => {
    const source = "　ＡＢＣ\r\nガ　";
    const normalized = normalizeCellValue(source, normalization({
      trim: true,
      caseInsensitive: true,
      width: "half",
      lineBreaks: "space",
    }));

    expect(normalized).toMatchObject({ kind: "text", value: "abc ｶﾞ", valid: true });
    expect(source).toBe("　ＡＢＣ\r\nガ　");
    expect(fullWidthToHalfWidth("ＡＢＣ　ガ")).toBe("ABC ｶﾞ");
    expect(halfWidthToFullWidth("ABC ｶﾞ")).toBe("ＡＢＣ　ガ");
  });

  it("can preserve or unify null, empty text, and platform line endings", () => {
    const unified = normalization({ emptyAsNull: true });
    expect(normalizeCellValue(null, unified).token)
      .toBe(normalizeCellValue("", unified).token);

    const strict = normalization({ emptyAsNull: false });
    expect(normalizeCellValue(null, strict).token)
      .not.toBe(normalizeCellValue("", strict).token);

    const lf = normalization({ lineBreaks: "lf" });
    expect(normalizeCellValue("A\r\nB", lf).token)
      .toBe(normalizeCellValue("A\nB", lf).token);
  });

  it("normalizes spreadsheet number formats and keeps invalid values explicit", () => {
    const options = normalization({ valueType: "number" });
    const tokens = ["1,000", 1000, "1000.00", "￥1,000", "１０００"]
      .map((value) => normalizeCellValue(value, options).token);

    expect(new Set(tokens)).toHaveLength(1);
    expect(normalizeCellValue("not-a-number", options)).toMatchObject({
      kind: "invalid",
      valid: false,
    });
  });

  it("does not collapse distinct high-precision decimal text through IEEE-754 rounding", () => {
    const options = normalization({ valueType: "number" });

    expect(normalizeCellValue("9007199254740992", options).token)
      .not.toBe(normalizeCellValue("9007199254740993", options).token);
    expect(normalizeCellValue("0.10000000000000000", options).token)
      .not.toBe(normalizeCellValue("0.10000000000000001", options).token);
    expect(normalizeCellValue("12.50%", options).value).toBe("0.125");
  });

  it("normalizes supported calendar dates and rejects impossible dates", () => {
    const options = normalization({ valueType: "date" });
    const values: CellValue[] = [
      "2026/08/22",
      "2026-08-22",
      "20260822",
      "2026年8月22日",
    ];
    const tokens = values.map((value) => normalizeCellValue(value, options).token);

    expect(new Set(tokens)).toHaveLength(1);
    expect(normalizeCellValue("2026-02-30", options)).toMatchObject({
      kind: "invalid",
      valid: false,
    });
  });

  it("handles the valid early Excel date serial boundary without an off-by-one day", () => {
    const options = normalization({ valueType: "date" });

    expect(normalizeCellValue(1, options).value).toBe("1900-01-01");
    expect(normalizeCellValue(59, options).value).toBe("1900-02-28");
    expect(normalizeCellValue(60, options)).toMatchObject({
      kind: "invalid",
      valid: false,
    });
    expect(normalizeCellValue(61, options).value).toBe("1900-03-01");
  });
});

const businessMappings: ColumnMapping[] = [
  { id: "customer", label: "顧客ID", baselineColumn: "顧客ID", comparisonColumn: "customerId" },
  { id: "store", label: "店舗", baselineColumn: "店舗コード", comparisonColumn: "store" },
  { id: "sku", label: "商品", baselineColumn: "商品コード", comparisonColumn: "productCode" },
  { id: "name", label: "氏名", baselineColumn: "氏名", comparisonColumn: "customerName" },
  { id: "price", label: "価格", baselineColumn: "価格", comparisonColumn: "unitPrice" },
  { id: "status", label: "Status", baselineColumn: "状態", comparisonColumn: "state" },
  { id: "ignored", label: "更新日時", baselineColumn: "更新日時", comparisonColumn: "updatedAt" },
];

function businessFixture() {
  const baseline = createDataSet(
    "baseline",
    ["顧客ID", "店舗コード", "商品コード", "氏名", "価格", "状態", "更新日時"],
    [
      ["C-001", "T", "A", "Alice", 1000, "Active", "2026-07-01"],
      ["C-002", "T", "B", "Bob", 2000, "Active", "2026-07-01"],
      ["C-003", "O", "C", "Carol", 3000, "Active", "2026-07-01"],
      ["C-004", "O", "D", "Dave", 4000, "Active", "2026-07-01"],
    ],
  );
  const comparison = createDataSet(
    "comparison",
    ["customerId", "store", "productCode", "customerName", "unitPrice", "state", "updatedAt"],
    [
      ["C-001", "T", "A", " Alice ", "1,000.00", "ACTIVE", "2026-08-01"],
      ["C-002", "T", "B", "Robert", "2,300.00", "Active", "2026-08-01"],
      ["C-004", "O", "D", "Dave", 4000, "Inactive", "2026-08-01"],
      ["C-005", "N", "E", "Erin", 5000, "Active", "2026-08-01"],
    ],
  );
  const config = simpleConfig(
    businessMappings,
    ["store", "sku"],
    ["name", "price", "status"],
    {
      normalizationByMappingId: {
        name: { trim: true },
        price: { valueType: "number" },
        status: { caseInsensitive: true },
      },
    },
  );
  return { baseline, comparison, config };
}

describe("deterministic reconciliation", () => {
  it("maps different headers, matches a composite key, and classifies every status", () => {
    const { baseline, comparison, config } = businessFixture();
    const baselineBefore = structuredClone(baseline);
    const comparisonBefore = structuredClone(comparison);

    const result = reconcileDataSets(baseline, comparison, config);

    expect(result.records.map((record) => record.status)).toEqual([
      "unchanged",
      "changed",
      "removed",
      "changed",
      "added",
    ]);
    expect(result.summary).toMatchObject({
      baselineRows: 4,
      comparisonRows: 4,
      totalRecords: 5,
      added: 1,
      removed: 1,
      changed: 2,
      unchanged: 1,
      duplicateKeys: 0,
      missingKeyRows: 0,
      errorRows: 0,
      differenceRate: 0.8,
      matchRate: 0.2,
    });
    expect(result.records[0].keyDisplay).toBe("店舗: T / 商品: A");
    expect(JSON.parse(result.records[0].keyToken)).toHaveLength(2);

    const priceAndName = result.records.find((record) => record.keyDisplay.endsWith("商品: B"));
    expect(priceAndName?.changes).toEqual([
      {
        mappingId: "name",
        label: "氏名",
        baselineColumn: "氏名",
        comparisonColumn: "customerName",
        before: "Bob",
        after: "Robert",
      },
      {
        mappingId: "price",
        label: "価格",
        baselineColumn: "価格",
        comparisonColumn: "unitPrice",
        before: 2000,
        after: "2,300.00",
      },
    ]);
    expect(result.records.find((record) => record.keyDisplay.endsWith("商品: D"))?.changes)
      .toEqual([expect.objectContaining({ mappingId: "status", before: "Active", after: "Inactive" })]);

    // The ignored timestamp differs in every matched row but cannot create a diff.
    expect(result.records.flatMap((record) => record.changes).some((change) => change.mappingId === "ignored"))
      .toBe(false);
    expect(baseline).toEqual(baselineBefore);
    expect(comparison).toEqual(comparisonBefore);
  });

  it("keeps leading-zero identifiers distinct unless number normalization is explicitly enabled", () => {
    const mapping: ColumnMapping = {
      id: "key",
      label: "Key",
      baselineColumn: "code",
      comparisonColumn: "code",
    };
    const baseline = createDataSet("baseline", ["code"], [["001"]]);
    const comparison = createDataSet("comparison", ["code"], [[1]]);

    const textResult = reconcileDataSets(
      baseline,
      comparison,
      simpleConfig([mapping], ["key"]),
    );
    expect(textResult.records.map((record) => record.status)).toEqual(["removed", "added"]);

    const numberResult = reconcileDataSets(
      baseline,
      comparison,
      simpleConfig([mapping], ["key"], [], {
        normalizationByMappingId: { key: { valueType: "number" } },
      }),
    );
    expect(numberResult.records).toHaveLength(1);
    expect(numberResult.records[0].status).toBe("unchanged");
  });

  it("treats numeric zero and boolean false as valid keys", () => {
    const mapping: ColumnMapping = {
      id: "key",
      label: "Key",
      baselineColumn: "key",
      comparisonColumn: "key",
    };
    const baseline = createDataSet("baseline", ["key"], [[0], [false]]);
    const comparison = createDataSet("comparison", ["key"], [["0"], ["false"]]);
    const result = reconcileDataSets(baseline, comparison, simpleConfig([mapping], ["key"]));

    expect(result.records.map((record) => record.status)).toEqual(["unchanged", "unchanged"]);
    expect(result.errors).toHaveLength(0);
  });

  it("serializes composite key parts as a JSON tuple so delimiters cannot collide", () => {
    const mappings: ColumnMapping[] = [
      { id: "one", label: "One", baselineColumn: "one", comparisonColumn: "one" },
      { id: "two", label: "Two", baselineColumn: "two", comparisonColumn: "two" },
    ];
    const baseline = createDataSet("baseline", ["one", "two"], [
      ["a|b", "c"],
      ["a", "b|c"],
    ]);
    const comparison = createDataSet("comparison", ["one", "two"], [
      ["a|b", "c"],
      ["a", "b|c"],
    ]);
    const result = reconcileDataSets(baseline, comparison, simpleConfig(mappings, ["one", "two"]));

    expect(result.records.map((record) => record.status)).toEqual(["unchanged", "unchanged"]);
    expect(new Set(result.records.map((record) => record.keyToken))).toHaveLength(2);
  });
});

describe("duplicates and unmatchable rows", () => {
  const mappings: ColumnMapping[] = [
    { id: "key", label: "Key", baselineColumn: "key", comparisonColumn: "key" },
    { id: "value", label: "Value", baselineColumn: "value", comparisonColumn: "value" },
  ];

  it("quarantines the complete key group when either side is duplicated after normalization", () => {
    const baseline = createDataSet("baseline", ["key", "value"], [
      ["A", "base-a1"],
      [" a ", "base-a2"],
      ["B", "base-b"],
      [null, "missing"],
      ["C", "removed"],
    ]);
    const comparison = createDataSet("comparison", ["key", "value"], [
      ["A", "compare-a"],
      ["B", "compare-b1"],
      [" b ", "compare-b2"],
      ["D", "added"],
      ["", "missing"],
    ]);
    const config = simpleConfig(mappings, ["key"], ["value"], {
      normalization: normalization({ trim: true, caseInsensitive: true }),
    });

    const result = reconcileDataSets(baseline, comparison, config);

    expect(result.records.map((record) => [record.keyDisplay, record.status])).toEqual([
      ["C", "removed"],
      ["D", "added"],
    ]);
    expect(result.duplicates).toHaveLength(2);
    expect(result.duplicates[0]).toMatchObject({
      keyDisplay: "A",
      duplicateSides: ["baseline"],
    });
    expect(result.duplicates[0].baselineRows).toHaveLength(2);
    expect(result.duplicates[0].comparisonRows).toHaveLength(1);
    expect(result.duplicates[1]).toMatchObject({
      keyDisplay: "B",
      duplicateSides: ["comparison"],
    });
    expect(result.summary).toMatchObject({
      totalRecords: 2,
      added: 1,
      removed: 1,
      duplicateKeys: 2,
      duplicateBaselineRows: 2,
      duplicateComparisonRows: 2,
      ambiguousRows: 6,
      missingKeyRows: 2,
      errorRows: 2,
    });
    expect(result.errors.map((issue) => [issue.side, issue.reason, issue.mappingIds]))
      .toEqual([
        ["baseline", "missing-key", ["key"]],
        ["comparison", "missing-key", ["key"]],
      ]);
  });

  it("marks any missing composite-key component as unmatchable", () => {
    const compositeMappings: ColumnMapping[] = [
      { id: "store", label: "Store", baselineColumn: "store", comparisonColumn: "store" },
      { id: "sku", label: "SKU", baselineColumn: "sku", comparisonColumn: "sku" },
    ];
    const baseline = createDataSet("baseline", ["store", "sku"], [["TOKYO", ""]]);
    const comparison = createDataSet("comparison", ["store", "sku"], [["TOKYO", "A-1"]]);
    const result = reconcileDataSets(
      baseline,
      comparison,
      simpleConfig(compositeMappings, ["store", "sku"]),
    );

    expect(result.errors[0]).toMatchObject({ reason: "missing-key", mappingIds: ["sku"] });
    expect(result.records.map((record) => record.status)).toEqual(["added"]);
  });

  it("fails closed when a key cannot use its requested normalization", () => {
    const mapping: ColumnMapping = {
      id: "key",
      label: "Key",
      baselineColumn: "key",
      comparisonColumn: "key",
    };
    const baseline = createDataSet("baseline", ["key"], [["not-a-number"]]);
    const comparison = createDataSet("comparison", ["key"], [["not-a-number"]]);
    const result = reconcileDataSets(
      baseline,
      comparison,
      simpleConfig([mapping], ["key"], [], {
        normalizationByMappingId: { key: { valueType: "number" } },
      }),
    );

    expect(result.records).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((issue) => issue.reason === "normalization-error")).toBe(true);
    expect(result.summary).toMatchObject({ normalizationErrorRows: 2, errorRows: 2 });
  });
});

describe("configuration validation", () => {
  const baseline = createDataSet("baseline", ["id", "value"], [["1", "A"]]);
  const comparison = createDataSet("comparison", ["key", "value"], [["1", "A"]]);
  const validMappings: ColumnMapping[] = [
    { id: "id", label: "ID", baselineColumn: "id", comparisonColumn: "key" },
    { id: "value", label: "Value", baselineColumn: "value", comparisonColumn: "value" },
  ];

  it("accepts a valid mapping and rejects missing or duplicate columns", () => {
    const valid = simpleConfig(validMappings, ["id"], ["value"]);
    expect(() => validateReconciliationConfig(baseline, comparison, valid)).not.toThrow();

    const missing = simpleConfig(
      [{ ...validMappings[0], comparisonColumn: "missing" }],
      ["id"],
    );
    expect(() => validateReconciliationConfig(baseline, comparison, missing))
      .toThrowError(ReconciliationConfigError);

    const duplicate = simpleConfig(
      [validMappings[0], { ...validMappings[1], baselineColumn: "id" }],
      ["id"],
    );
    expect(() => validateReconciliationConfig(baseline, comparison, duplicate))
      .toThrow("複数回Mapping");
  });

  it("rejects stale key, comparison, and normalization references", () => {
    expect(() => validateReconciliationConfig(
      baseline,
      comparison,
      simpleConfig(validMappings, ["unknown"]),
    )).toThrow("照合KeyのMapping");

    expect(() => validateReconciliationConfig(
      baseline,
      comparison,
      simpleConfig(validMappings, ["id"], ["id"]),
    )).toThrow("重複指定");

    expect(() => validateReconciliationConfig(
      baseline,
      comparison,
      simpleConfig(validMappings, ["id"], ["value"], {
        normalizationByMappingId: { unknown: { trim: true } },
      }),
    )).toThrow("正規化対象");
  });
});

describe("result selectors", () => {
  it("filters by status/changed column/search and provides deterministic sorts", () => {
    const { baseline, comparison, config } = businessFixture();
    const result = reconcileDataSets(baseline, comparison, config);

    const priceChanges = selectReconciliationItems(result, baseline, comparison, {
      statuses: ["changed"],
      changedMappingIds: ["price"],
    });
    expect(priceChanges).toHaveLength(1);
    expect(priceChanges[0].value.keyDisplay).toBe("店舗: T / 商品: B");

    const searched = selectReconciliationItems(result, baseline, comparison, {
      search: "ＥＲＩＮ",
    });
    expect(searched).toHaveLength(1);
    expect(searched[0].status).toBe("added");

    const changeOrder = selectReconciliationItems(result, baseline, comparison, {
      statuses: ["changed"],
      sort: "changes-desc",
    });
    expect(changeOrder.map((item) => item.value.keyDisplay)).toEqual([
      "店舗: T / 商品: B",
      "店舗: O / 商品: D",
    ]);

    const keyOrder = selectReconciliationItems(result, baseline, comparison, {
      statuses: ["added", "removed"],
      sort: "key-asc",
    });
    expect(keyOrder.map((item) => item.value.keyDisplay)).toEqual([
      "店舗: N / 商品: E",
      "店舗: O / 商品: C",
    ]);
  });

  it("exposes duplicate and error statuses to the same selector", () => {
    const mappings: ColumnMapping[] = [
      { id: "key", label: "Key", baselineColumn: "key", comparisonColumn: "key" },
    ];
    const baseline = createDataSet("baseline", ["key"], [["A"], ["A"], [null]]);
    const comparison = createDataSet("comparison", ["key"], [["A"]]);
    const config = simpleConfig(mappings, ["key"]);
    const result = reconcileDataSets(baseline, comparison, config);

    expect(selectReconciliationItems(result, baseline, comparison, { statuses: ["duplicate"] }))
      .toHaveLength(1);
    expect(selectReconciliationItems(result, baseline, comparison, { statuses: ["error"] }))
      .toHaveLength(1);
  });
});

describe("large deterministic comparison", () => {
  it("correctly reconciles 10,000 baseline rows with controlled additions, removals, and changes", () => {
    const baselineRows = Array.from({ length: 10_000 }, (_, index) => [
      `ID-${String(index).padStart(5, "0")}`,
      index,
    ] satisfies CellValue[]);
    const comparisonRows = [
      ...Array.from({ length: 9_900 }, (_, index) => [
        `ID-${String(index).padStart(5, "0")}`,
        index < 100 ? index + 100_000 : index,
      ] satisfies CellValue[]),
      ...Array.from({ length: 100 }, (_, offset) => {
        const index = 10_000 + offset;
        return [`ID-${String(index).padStart(5, "0")}`, index] satisfies CellValue[];
      }),
    ];
    const baseline = createDataSet("baseline", ["id", "value"], baselineRows);
    const comparison = createDataSet("comparison", ["id", "value"], comparisonRows);
    const mappings: ColumnMapping[] = [
      { id: "id", label: "ID", baselineColumn: "id", comparisonColumn: "id" },
      { id: "value", label: "Value", baselineColumn: "value", comparisonColumn: "value" },
    ];

    const result = reconcileDataSets(
      baseline,
      comparison,
      simpleConfig(mappings, ["id"], ["value"]),
    );

    expect(result.summary).toMatchObject({
      baselineRows: 10_000,
      comparisonRows: 10_000,
      totalRecords: 10_100,
      changed: 100,
      unchanged: 9_800,
      removed: 100,
      added: 100,
      duplicateKeys: 0,
      errorRows: 0,
    });
    expect(result.records).toHaveLength(10_100);
  }, 15_000);
});
