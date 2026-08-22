import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  RECONCILIATION_REPORT_SHEET_NAMES,
  createReconciliationCsvReport,
  createReconciliationXlsxReport,
  type ReconciliationReportSource,
} from "./export-report";
import {
  DEFAULT_NORMALIZATION_OPTIONS,
  reconcileDataSets,
  type ColumnMapping,
  type ReconciliationConfig,
  type ReconciliationListItem,
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
    metadata: {
      source: {
        fileName: `${id}.xlsx`,
        fileType: "xlsx",
        fileSize: 100,
        rowCount: values.length,
        columnCount: headers.length,
        sheetNames: ["Data"],
        activeSheet: "Data",
      },
    },
  };
}

const mappings: ColumnMapping[] = [
  { id: "id", label: "ID", baselineColumn: "id", comparisonColumn: "recordId" },
  { id: "name", label: "Name", baselineColumn: "name", comparisonColumn: "fullName" },
  { id: "amount", label: "Amount", baselineColumn: "amount", comparisonColumn: "total" },
  { id: "note", label: "Note", baselineColumn: "note", comparisonColumn: "comment" },
];

function fixture(): ReconciliationReportSource {
  const baseline = createDataSet(
    "baseline",
    ["id", "name", "amount", "note"],
    [
      ["A", "same", 1, "safe"],
      ["B", "before", 10, "safe"],
      ["C", "removed", 30, "-danger"],
      ["DUP", "one", 40, "safe"],
      ["DUP", "two", 41, "safe"],
      [null, "missing", 50, "@danger"],
    ],
  );
  const comparison = createDataSet(
    "comparison",
    ["recordId", "fullName", "total", "comment"],
    [
      ["A", "same", 1, "safe"],
      ["B", "after", 20, "=2+2"],
      ["E", "added", 60, "\u00A0+SUM(1,1)"],
      ["DUP", "counterpart", 42, "safe"],
      ["", "missing", 70, "=CMD()"],
    ],
  );
  const config: ReconciliationConfig = {
    version: 1,
    mappings,
    keyMappingIds: ["id"],
    compareMappingIds: ["name", "amount", "note"],
    normalization: { ...DEFAULT_NORMALIZATION_OPTIONS },
  };
  return {
    baseline,
    comparison,
    config,
    result: reconcileDataSets(baseline, comparison, config),
  };
}

function sheetRows(
  workbook: XLSX.WorkBook,
  name: string,
): Record<string, unknown>[] {
  const worksheet = workbook.Sheets[name];
  if (!worksheet) throw new Error(`Missing worksheet: ${name}`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: true,
  });
}

describe("XLSX reconciliation report", () => {
  it("round-trips all report sheets, counts, source values, and long-form cell diffs", () => {
    const source = fixture();
    const bytes = createReconciliationXlsxReport(source);
    const workbook = XLSX.read(bytes, { type: "array" });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(workbook.SheetNames).toEqual(RECONCILIATION_REPORT_SHEET_NAMES);
    expect(sheetRows(workbook, "Added")).toHaveLength(1);
    expect(sheetRows(workbook, "Removed")).toHaveLength(1);
    expect(sheetRows(workbook, "Changed")).toHaveLength(1);
    expect(sheetRows(workbook, "Unchanged")).toHaveLength(1);
    expect(sheetRows(workbook, "Duplicates")).toHaveLength(3);
    expect(sheetRows(workbook, "Errors")).toHaveLength(2);

    const summary = Object.fromEntries(
      sheetRows(workbook, "Summary").map((row) => [row.Metric, row.Value]),
    );
    expect(summary).toMatchObject({
      "Baseline Rows": 6,
      "Comparison Rows": 5,
      "Total Records": 4,
      Added: 1,
      Removed: 1,
      Changed: 1,
      Unchanged: 1,
      "Duplicate Keys": 1,
      "Error Rows": 2,
    });

    const changed = sheetRows(workbook, "Changed")[0];
    expect(changed).toMatchObject({
      Key: "B",
      "Baseline: amount": 10,
      "Comparison: total": 20,
      "Comparison: comment": "'=2+2",
    });

    const diffs = sheetRows(workbook, "Diff Report");
    expect(diffs).toHaveLength(3);
    expect(diffs).toContainEqual(expect.objectContaining({
      Key: "B",
      Column: "Amount",
      Before: 10,
      After: 20,
    }));
    expect(diffs).toContainEqual(expect.objectContaining({
      Key: "B",
      Column: "Note",
      Before: "safe",
      After: "'=2+2",
    }));

    const changedSheet = workbook.Sheets.Changed;
    const commentHeaderCell = Object.entries(changedSheet)
      .find(([, cell]) => typeof cell === "object" && cell !== null && "v" in cell
        && (cell as XLSX.CellObject).v === "Comparison: comment");
    expect(commentHeaderCell).toBeDefined();
    const commentColumn = XLSX.utils.decode_cell(commentHeaderCell![0]).c;
    const dangerousCell = changedSheet[XLSX.utils.encode_cell({ r: 1, c: commentColumn })];
    expect(dangerousCell).toMatchObject({ t: "s", v: "'=2+2" });
    expect(dangerousCell?.f).toBeUndefined();
  });
});

describe("CSV reconciliation report", () => {
  it("writes a BOM, protects formula-like text, and supports all or filtered items", () => {
    const source = fixture();
    const allBytes = createReconciliationCsvReport(source);
    const allText = new TextDecoder().decode(allBytes);
    const allWorkbook = XLSX.read(allText, { type: "string" });
    const allRows = sheetRows(allWorkbook, allWorkbook.SheetNames[0]);

    expect(Array.from(allBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(allRows).toHaveLength(7);

    const filteredItems: ReconciliationListItem[] = [
      {
        kind: "record",
        status: "changed",
        value: source.result.records.find((record) => record.status === "changed")!,
      },
      {
        kind: "record",
        status: "added",
        value: source.result.records.find((record) => record.status === "added")!,
      },
    ];
    const filteredBytes = createReconciliationCsvReport(source, { items: filteredItems });
    const filteredText = new TextDecoder().decode(filteredBytes);
    const filteredWorkbook = XLSX.read(filteredText, { type: "string" });
    const filteredRows = sheetRows(filteredWorkbook, filteredWorkbook.SheetNames[0]);

    expect(filteredRows).toHaveLength(2);
    expect(filteredRows.map((row) => row.Status)).toEqual(["Changed", "Added"]);
    expect(filteredText).toContain("\"'=2+2\"");
    expect(filteredText).toContain("\"'\u00A0+SUM(1,1)\"");
    expect(filteredRows[0]["Comparison: comment"]).toBe("'=2+2");
    expect(filteredRows[1]["Comparison: comment"]).toBe("'\u00A0+SUM(1,1)");
  });
});
