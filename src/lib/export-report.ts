import * as XLSX from "xlsx";

import {
  type DataSide,
  type DuplicateGroup,
  type ReconciledRecord,
  type ReconciliationConfig,
  type ReconciliationListItem,
  type ReconciliationResult,
  type ReconciliationStatus,
  type RowIssue,
  type RowPointer,
} from "./reconciliation";
import {
  ROW_ID_KEY,
  type CellValue,
  type DataRow,
  type DataSet,
} from "./types";

export const RECONCILIATION_XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const RECONCILIATION_CSV_MIME_TYPE = "text/csv;charset=utf-8";

export const RECONCILIATION_XLSX_FILENAME = "reconciliation-report.xlsx";
export const RECONCILIATION_CSV_FILENAME = "reconciliation-report.csv";

export const RECONCILIATION_REPORT_SHEET_NAMES = [
  "Summary",
  "Added",
  "Removed",
  "Changed",
  "Unchanged",
  "Duplicates",
  "Diff Report",
  "Errors",
] as const;

export interface ReconciliationReportSource {
  baseline: DataSet;
  comparison: DataSet;
  result: ReconciliationResult;
  config: ReconciliationConfig;
}

export interface ReconciliationCsvReportOptions {
  /** Omit this option to export every record, duplicate group, and error. */
  items?: readonly ReconciliationListItem[];
}

type ReportCell = CellValue | undefined;
type ReportRow = readonly ReportCell[];

const FORMULA_LIKE_TEXT = /^[\u0000-\u0020\uFEFF\p{White_Space}]*[=+\-@]/u;

const STATUS_LABELS: Readonly<Record<ReconciliationStatus, string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
};

const SIDE_LABELS: Readonly<Record<DataSide, string>> = {
  baseline: "Baseline",
  comparison: "Comparison",
};

/**
 * Prefixes formula-like strings with an apostrophe before they cross a
 * spreadsheet boundary. Numbers and booleans remain typed values.
 */
function protectSpreadsheetCell(value: ReportCell): CellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && FORMULA_LIKE_TEXT.test(value)) {
    return `'${value}`;
  }
  return value;
}

function resolveRow(dataSet: DataSet, pointer: RowPointer): DataRow {
  const row = dataSet.rows[pointer.rowIndex];
  if (!row || row[ROW_ID_KEY] !== pointer.rowId) {
    throw new Error(
      `Unable to resolve ${dataSet.name} row ${pointer.rowIndex + 1} (${pointer.rowId}).`,
    );
  }
  return row;
}

function rawCell(row: DataRow | undefined, header: string): CellValue {
  return row?.[header] ?? null;
}

function rawRowCells(dataSet: DataSet, row: DataRow | undefined): CellValue[] {
  return dataSet.headers.map((header) => rawCell(row, header));
}

function sourceHeaders(prefix: string, dataSet: DataSet): string[] {
  return dataSet.headers.map((header) => `${prefix}: ${header}`);
}

function rowNumber(pointer: RowPointer | undefined): number | null {
  return pointer ? pointer.rowIndex + 1 : null;
}

function blankCells(count: number): null[] {
  return Array.from({ length: count }, () => null);
}

function displayCell(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function mappingLabels(config: ReconciliationConfig, mappingIds: readonly string[]): string {
  const labels = new Map(config.mappings.map((mapping) => [mapping.id, mapping.label]));
  return mappingIds.map((id) => labels.get(id) ?? id).join(", ");
}

function createWorksheet(rows: readonly ReportRow[]): XLSX.WorkSheet {
  const safeRows = rows.map((row) => row.map(protectSpreadsheetCell));
  const worksheet = XLSX.utils.aoa_to_sheet(safeRows);
  const columnCount = safeRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);

  worksheet["!cols"] = Array.from({ length: columnCount }, (_, columnIndex) => {
    const width = safeRows.reduce((maximum, row) => {
      const value = row[columnIndex];
      if (value === null || value === undefined) return maximum;
      return Math.max(maximum, displayCell(value).length);
    }, 0);
    return { wch: Math.min(Math.max(width + 2, 10), 48) };
  });

  if (safeRows.length > 0 && columnCount > 0) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(safeRows.length - 1, 0), c: columnCount - 1 },
      }),
    };
  }

  return worksheet;
}

function summaryRows(source: ReconciliationReportSource): ReportRow[] {
  const { baseline, comparison, config, result } = source;
  const { summary } = result;
  const mappingById = new Map(config.mappings.map((mapping) => [mapping.id, mapping]));
  const keyLabels = config.keyMappingIds
    .map((id) => mappingById.get(id)?.label ?? id)
    .join(", ");
  const compareLabels = config.compareMappingIds
    .map((id) => mappingById.get(id)?.label ?? id)
    .join(", ");

  return [
    ["Metric", "Value"],
    ["Baseline Dataset", baseline.name],
    ["Comparison Dataset", comparison.name],
    ["Baseline File", baseline.metadata?.source?.fileName ?? baseline.name],
    ["Comparison File", comparison.metadata?.source?.fileName ?? comparison.name],
    ["Key Columns", keyLabels],
    ["Compared Columns", compareLabels],
    ["Baseline Rows", summary.baselineRows],
    ["Comparison Rows", summary.comparisonRows],
    ["Total Records", summary.totalRecords],
    ["Added", summary.added],
    ["Removed", summary.removed],
    ["Changed", summary.changed],
    ["Unchanged", summary.unchanged],
    ["Duplicate Keys", summary.duplicateKeys],
    ["Duplicate Baseline Rows", summary.duplicateBaselineRows],
    ["Duplicate Comparison Rows", summary.duplicateComparisonRows],
    ["Ambiguous Rows", summary.ambiguousRows],
    ["Missing Key Rows", summary.missingKeyRows],
    ["Normalization Error Rows", summary.normalizationErrorRows],
    ["Error Rows", summary.errorRows],
    ["Difference Rate", summary.differenceRate],
    ["Match Rate", summary.matchRate],
  ];
}

function singleSideRecordRows(
  source: ReconciliationReportSource,
  status: "added" | "removed",
): ReportRow[] {
  const dataSet = status === "added" ? source.comparison : source.baseline;
  const pointerKey = status === "added" ? "comparison" : "baseline";
  const prefix = status === "added" ? "Comparison" : "Baseline";
  const records = source.result.records.filter((record) => record.status === status);

  return [
    ["Key", "Status", `${prefix} Row`, ...sourceHeaders(prefix, dataSet)],
    ...records.map((record): ReportRow => {
      const pointer = record[pointerKey];
      if (!pointer) {
        throw new Error(`${STATUS_LABELS[status]} record ${record.keyDisplay} has no ${pointerKey} row.`);
      }
      const row = resolveRow(dataSet, pointer);
      return [record.keyDisplay, STATUS_LABELS[status], rowNumber(pointer), ...rawRowCells(dataSet, row)];
    }),
  ];
}

function pairedRecordRows(
  source: ReconciliationReportSource,
  status: "changed" | "unchanged",
): ReportRow[] {
  const records = source.result.records.filter((record) => record.status === status);
  return [
    [
      "Key",
      "Status",
      "Changed Columns",
      "Baseline Row",
      "Comparison Row",
      ...sourceHeaders("Baseline", source.baseline),
      ...sourceHeaders("Comparison", source.comparison),
    ],
    ...records.map((record): ReportRow => {
      if (!record.baseline || !record.comparison) {
        throw new Error(`${STATUS_LABELS[status]} record ${record.keyDisplay} is missing a source row.`);
      }
      const baselineRow = resolveRow(source.baseline, record.baseline);
      const comparisonRow = resolveRow(source.comparison, record.comparison);
      return [
        record.keyDisplay,
        STATUS_LABELS[status],
        record.changes.map((change) => change.label).join(", "),
        rowNumber(record.baseline),
        rowNumber(record.comparison),
        ...rawRowCells(source.baseline, baselineRow),
        ...rawRowCells(source.comparison, comparisonRow),
      ];
    }),
  ];
}

function duplicateRows(source: ReconciliationReportSource): ReportRow[] {
  const headers: ReportRow = [
    "Key",
    "Duplicate Sides",
    "Side",
    "Source Row",
    ...sourceHeaders("Baseline", source.baseline),
    ...sourceHeaders("Comparison", source.comparison),
  ];
  const rows: ReportRow[] = [headers];

  for (const group of source.result.duplicates) {
    const duplicateSides = group.duplicateSides.map((side) => SIDE_LABELS[side]).join(" / ");
    for (const pointer of group.baselineRows) {
      const row = resolveRow(source.baseline, pointer);
      rows.push([
        group.keyDisplay,
        duplicateSides,
        SIDE_LABELS.baseline,
        rowNumber(pointer),
        ...rawRowCells(source.baseline, row),
        ...blankCells(source.comparison.headers.length),
      ]);
    }
    for (const pointer of group.comparisonRows) {
      const row = resolveRow(source.comparison, pointer);
      rows.push([
        group.keyDisplay,
        duplicateSides,
        SIDE_LABELS.comparison,
        rowNumber(pointer),
        ...blankCells(source.baseline.headers.length),
        ...rawRowCells(source.comparison, row),
      ]);
    }
  }

  return rows;
}

function diffRows(source: ReconciliationReportSource): ReportRow[] {
  const rows: ReportRow[] = [[
    "Key",
    "Column",
    "Before",
    "After",
    "Baseline Row",
    "Comparison Row",
    "Baseline Source Column",
    "Comparison Source Column",
  ]];

  for (const record of source.result.records) {
    if (record.status !== "changed" || !record.baseline || !record.comparison) continue;
    const baselineRow = resolveRow(source.baseline, record.baseline);
    const comparisonRow = resolveRow(source.comparison, record.comparison);
    for (const change of record.changes) {
      rows.push([
        record.keyDisplay,
        change.label,
        rawCell(baselineRow, change.baselineColumn),
        rawCell(comparisonRow, change.comparisonColumn),
        rowNumber(record.baseline),
        rowNumber(record.comparison),
        change.baselineColumn,
        change.comparisonColumn,
      ]);
    }
  }

  return rows;
}

function errorRows(source: ReconciliationReportSource): ReportRow[] {
  const rows: ReportRow[] = [[
    "Key",
    "Side",
    "Reason",
    "Columns",
    "Message",
    "Source Row",
    ...sourceHeaders("Baseline", source.baseline),
    ...sourceHeaders("Comparison", source.comparison),
  ]];

  for (const issue of source.result.errors) {
    const dataSet = issue.side === "baseline" ? source.baseline : source.comparison;
    const row = resolveRow(dataSet, issue.row);
    const baselineCells = issue.side === "baseline"
      ? rawRowCells(source.baseline, row)
      : blankCells(source.baseline.headers.length);
    const comparisonCells = issue.side === "comparison"
      ? rawRowCells(source.comparison, row)
      : blankCells(source.comparison.headers.length);
    rows.push([
      issue.keyDisplay,
      SIDE_LABELS[issue.side],
      issue.reason,
      mappingLabels(source.config, issue.mappingIds),
      issue.message,
      rowNumber(issue.row),
      ...baselineCells,
      ...comparisonCells,
    ]);
  }

  return rows;
}

function allListItems(result: ReconciliationResult): ReconciliationListItem[] {
  return [
    ...result.records.map((value): ReconciliationListItem => ({
      kind: "record",
      status: value.status,
      value,
    })),
    ...result.duplicates.map((value): ReconciliationListItem => ({
      kind: "duplicate",
      status: "duplicate",
      value,
    })),
    ...result.errors.map((value): ReconciliationListItem => ({
      kind: "error",
      status: "error",
      value,
    })),
  ];
}

function rowsFromPointers(dataSet: DataSet, pointers: readonly RowPointer[]): DataRow[] {
  return pointers.map((pointer) => resolveRow(dataSet, pointer));
}

function joinedRowNumbers(pointers: readonly RowPointer[]): string {
  return pointers.map((pointer) => String(pointer.rowIndex + 1)).join(", ");
}

function aggregateRawCell(rows: readonly DataRow[], header: string): CellValue {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rawCell(rows[0], header);
  return rows.map((row) => displayCell(rawCell(row, header))).join("\n");
}

interface CsvItemContext {
  status: string;
  key: string;
  side: string;
  columns: string;
  before: string;
  after: string;
  message: string;
  baselinePointers: readonly RowPointer[];
  comparisonPointers: readonly RowPointer[];
  duplicateSides: string;
}

function recordCsvContext(record: ReconciledRecord): CsvItemContext {
  return {
    status: STATUS_LABELS[record.status],
    key: record.keyDisplay,
    side: record.status === "added"
      ? SIDE_LABELS.comparison
      : record.status === "removed"
        ? SIDE_LABELS.baseline
        : "Both",
    columns: record.changes.map((change) => change.label).join(", "),
    before: record.changes
      .map((change) => `${change.label}: ${displayCell(change.before)}`)
      .join("\n"),
    after: record.changes
      .map((change) => `${change.label}: ${displayCell(change.after)}`)
      .join("\n"),
    message: "",
    baselinePointers: record.baseline ? [record.baseline] : [],
    comparisonPointers: record.comparison ? [record.comparison] : [],
    duplicateSides: "",
  };
}

function duplicateCsvContext(group: DuplicateGroup): CsvItemContext {
  const duplicateSides = group.duplicateSides.map((side) => SIDE_LABELS[side]).join(" / ");
  return {
    status: "Duplicate",
    key: group.keyDisplay,
    side: duplicateSides,
    columns: "",
    before: "",
    after: "",
    message: `Duplicate key on ${duplicateSides}`,
    baselinePointers: group.baselineRows,
    comparisonPointers: group.comparisonRows,
    duplicateSides,
  };
}

function errorCsvContext(issue: RowIssue, config: ReconciliationConfig): CsvItemContext {
  return {
    status: "Error",
    key: issue.keyDisplay,
    side: SIDE_LABELS[issue.side],
    columns: mappingLabels(config, issue.mappingIds),
    before: "",
    after: "",
    message: issue.message,
    baselinePointers: issue.side === "baseline" ? [issue.row] : [],
    comparisonPointers: issue.side === "comparison" ? [issue.row] : [],
    duplicateSides: "",
  };
}

function csvItemContext(
  item: ReconciliationListItem,
  config: ReconciliationConfig,
): CsvItemContext {
  if (item.kind === "record") return recordCsvContext(item.value);
  if (item.kind === "duplicate") return duplicateCsvContext(item.value);
  return errorCsvContext(item.value, config);
}

function csvRows(
  source: ReconciliationReportSource,
  items: readonly ReconciliationListItem[],
): ReportRow[] {
  const rows: ReportRow[] = [[
    "Status",
    "Key",
    "Side",
    "Columns",
    "Before",
    "After",
    "Message",
    "Baseline Rows",
    "Comparison Rows",
    "Duplicate Sides",
    ...sourceHeaders("Baseline", source.baseline),
    ...sourceHeaders("Comparison", source.comparison),
  ]];

  for (const item of items) {
    const context = csvItemContext(item, source.config);
    const baselineRows = rowsFromPointers(source.baseline, context.baselinePointers);
    const comparisonRows = rowsFromPointers(source.comparison, context.comparisonPointers);
    rows.push([
      context.status,
      context.key,
      context.side,
      context.columns,
      context.before,
      context.after,
      context.message,
      joinedRowNumbers(context.baselinePointers),
      joinedRowNumbers(context.comparisonPointers),
      context.duplicateSides,
      ...source.baseline.headers.map((header) => aggregateRawCell(baselineRows, header)),
      ...source.comparison.headers.map((header) => aggregateRawCell(comparisonRows, header)),
    ]);
  }

  return rows;
}

function csvField(value: ReportCell): string {
  const safeValue = protectSpreadsheetCell(value);
  const text = safeValue === null ? "" : displayCell(safeValue);
  return `"${text.replaceAll('"', '""')}"`;
}

/** Creates browser/worker-safe XLSX bytes without using Blob, Buffer, or DOM APIs. */
export function createReconciliationXlsxReport(
  source: ReconciliationReportSource,
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheets: ReadonlyArray<readonly [string, readonly ReportRow[]]> = [
    ["Summary", summaryRows(source)],
    ["Added", singleSideRecordRows(source, "added")],
    ["Removed", singleSideRecordRows(source, "removed")],
    ["Changed", pairedRecordRows(source, "changed")],
    ["Unchanged", pairedRecordRows(source, "unchanged")],
    ["Duplicates", duplicateRows(source)],
    ["Diff Report", diffRows(source)],
    ["Errors", errorRows(source)],
  ];

  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, createWorksheet(rows), name);
  }

  const binary = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  }) as ArrayBuffer | Uint8Array;

  if (binary instanceof Uint8Array) return binary;
  return new Uint8Array(binary);
}

/** Creates a UTF-8 BOM CSV containing all items or an already-filtered list. */
export function createReconciliationCsvReport(
  source: ReconciliationReportSource,
  options: ReconciliationCsvReportOptions = {},
): Uint8Array {
  const items = options.items ?? allListItems(source.result);
  const text = csvRows(source, items)
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
  return new TextEncoder().encode(`\uFEFF${text}`);
}
