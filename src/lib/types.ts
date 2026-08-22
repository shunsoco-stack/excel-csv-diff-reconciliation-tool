export const ROW_ID_KEY = "__rowId" as const;

/**
 * Values exactly as exposed by the CSV/XLSX reader before reconciliation
 * normalization. CSV cells remain strings; XLSX numbers and booleans retain
 * their primitive types. Excel date cells are represented as local calendar
 * strings so a date cannot shift when the browser timezone changes.
 */
export type CellValue = string | number | boolean | null;

export type DataRow = Record<string, CellValue> & {
  [ROW_ID_KEY]: string;
};

export type InputDataRow = Record<string, CellValue | undefined> & {
  [ROW_ID_KEY]?: string;
};

export type SupportedFileType = "csv" | "xlsx";

export interface FileMetadata {
  fileName: string;
  fileType: SupportedFileType;
  fileSize: number;
  /** Sum of usable data rows across all imported sheets. */
  rowCount: number;
  /** Largest usable sheet width. */
  columnCount: number;
  /** Usable/selectable worksheet names. CSV imports use an empty array. */
  sheetNames: string[];
  activeSheet?: string;
  /** Empty worksheets omitted from a workbook import. */
  skippedSheetNames?: string[];
}

export interface DataSetMetadata {
  source?: FileMetadata;
  importedAt?: string;
  description?: string;
}

/**
 * A source dataset. File I/O creates this object from raw parsed cells and
 * never applies trim/case/number/date reconciliation rules to its rows.
 */
export interface DataSet {
  id: string;
  name: string;
  headers: string[];
  rows: DataRow[];
  metadata?: DataSetMetadata;
}
