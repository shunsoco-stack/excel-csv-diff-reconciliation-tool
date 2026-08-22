import {
  ROW_ID_KEY,
  type CellValue,
  type DataRow,
  type DataSet,
  type FileMetadata,
  type SupportedFileType,
} from "./types";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const CSV_DELIMITERS = [",", "\t", ";", "|"] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];
export type CsvTextEncoding = "utf-8" | "shift-jis";
export type FileEncoding = CsvTextEncoding | "binary";
export type BinaryInput = ArrayBuffer | Uint8Array;

export type FileImportErrorCode =
  | "empty-file"
  | "file-too-large"
  | "unsupported-format"
  | "missing-header"
  | "csv-parse-error"
  | "xlsx-parse-error"
  | "no-usable-sheet";

export class FileImportError extends Error {
  readonly code: FileImportErrorCode;

  constructor(code: FileImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FileImportError";
    this.code = code;
  }
}

export interface FileInfo {
  name: string;
  size?: number;
  type?: string;
}

export interface BrowserFileLike extends FileInfo {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface CsvParseOptions {
  delimiter?: CsvDelimiter;
  skipEmptyLines?: boolean;
  trimHeaders?: boolean;
  dataSetId?: string;
  dataSetName?: string;
}

export interface CsvParseResult {
  dataSet: DataSet;
  delimiter: CsvDelimiter;
}

export interface CsvDecodeResult {
  text: string;
  encoding: CsvTextEncoding;
  hadBom: boolean;
}

export interface ImportedFileMetadata extends FileMetadata {
  encoding: FileEncoding;
  delimiter?: CsvDelimiter;
}

export interface ImportedTabularFile {
  /** First/selectable dataset, for the common single-sheet case. */
  dataSet: DataSet;
  /** Every usable worksheet. CSV imports contain exactly one dataset. */
  dataSets: DataSet[];
  metadata: ImportedFileMetadata;
}

interface MatrixDataSetOptions {
  id: string;
  name: string;
  trimHeaders?: boolean;
  skipEmptyLines?: boolean;
}

const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
const DEFAULT_DELIMITER: CsvDelimiter = ",";

type XlsxModule = typeof import("xlsx");

let xlsxModulePromise: Promise<XlsxModule> | undefined;

function toBytes(input: BinaryInput): Uint8Array {
  return input instanceof Uint8Array
    ? input.slice()
    : new Uint8Array(input.slice(0));
}

function byteLength(input: BinaryInput): number {
  return input.byteLength;
}

function isUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= UTF8_BOM.length &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  );
}

async function loadEncodingJapanese() {
  const encodingModule = await import("encoding-japanese");
  return encodingModule.default;
}

async function loadXlsx(): Promise<XlsxModule> {
  xlsxModulePromise ??= import("xlsx").catch((error: unknown) => {
    xlsxModulePromise = undefined;
    throw error;
  });
  return xlsxModulePromise;
}

function stripSupportedExtension(fileName: string): string {
  return fileName.replace(/\.(?:csv|xlsx)$/iu, "") || fileName;
}

function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `dataset-${(hash >>> 0).toString(36)}`;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function isPhysicalBlankRecord(record: readonly unknown[]): boolean {
  // A physical blank line parses as one empty field. `,,` deliberately
  // declares three empty cells and is not the same thing as a blank line.
  return record.length === 0 || (record.length === 1 && isEmptyValue(record[0]));
}

function isEmptyDataRecord(record: readonly unknown[]): boolean {
  return record.every(isEmptyValue);
}

function normalizeHeaderValue(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function hasUsableHeader(sourceHeaders: readonly (CellValue | undefined)[]): boolean {
  return sourceHeaders.some((value) => normalizeHeaderValue(value).trim().length > 0);
}

/**
 * Empty header cells get a stable `列N` label and duplicate labels get a
 * suffix. Data cells are not trimmed or otherwise normalized.
 */
export function makeUniqueHeaders(
  sourceHeaders: readonly (CellValue | undefined)[],
  width: number = sourceHeaders.length,
  trimHeaders = true,
): string[] {
  const headers: string[] = [];
  const used = new Set<string>([ROW_ID_KEY]);

  for (let index = 0; index < width; index += 1) {
    const rawHeader = normalizeHeaderValue(sourceHeaders[index]);
    const normalizedHeader = trimHeaders ? rawHeader.trim() : rawHeader;
    const baseHeader = normalizedHeader || `列${index + 1}`;
    let candidate = baseHeader;
    let suffix = 2;

    while (used.has(candidate)) {
      candidate = `${baseHeader}_${suffix}`;
      suffix += 1;
    }

    used.add(candidate);
    headers.push(candidate);
  }

  return headers;
}

function parseCsvRecords(
  source: string,
  delimiter: CsvDelimiter,
  maximumRows = Number.POSITIVE_INFINITY,
): string[][] {
  if (source.length === 0) return [];

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedFieldClosed = false;
  let recordStarted = false;

  const finishRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
    quotedFieldClosed = false;
    recordStarted = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quotedFieldClosed = true;
        }
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        field += "\n";
      } else {
        field += character;
      }
      recordStarted = true;
      continue;
    }

    if (quotedFieldClosed) {
      if (character === delimiter) {
        record.push(field);
        field = "";
        quotedFieldClosed = false;
        recordStarted = true;
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        finishRecord();
        if (records.length >= maximumRows) break;
      } else {
        throw new FileImportError(
          "csv-parse-error",
          "CSVの引用符で囲まれた値の後に区切り文字以外があります。",
        );
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true;
      recordStarted = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
      recordStarted = true;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRecord();
      if (records.length >= maximumRows) break;
    } else {
      field += character;
      recordStarted = true;
    }
  }

  if (inQuotes) {
    throw new FileImportError(
      "csv-parse-error",
      "CSVの引用符が閉じられていません。",
    );
  }

  if (
    records.length < maximumRows &&
    (recordStarted || record.length > 0 || field.length > 0)
  ) {
    finishRecord();
  }

  return records;
}

/** Infer comma/tab/semicolon/pipe from complete logical rows and width consistency. */
export function detectCsvDelimiter(source: string): CsvDelimiter {
  const sample = source.replace(/^\uFEFF/u, "").slice(0, 128 * 1024);
  let bestDelimiter = DEFAULT_DELIMITER;
  let bestScore = Number.NEGATIVE_INFINITY;
  let headerFallback = DEFAULT_DELIMITER;
  let widestHeader = 1;

  for (const delimiter of CSV_DELIMITERS) {
    try {
      const firstRecord = parseCsvRecords(sample, delimiter, 1)
        .find((record) => !isPhysicalBlankRecord(record));
      if ((firstRecord?.length ?? 0) > widestHeader) {
        widestHeader = firstRecord!.length;
        headerFallback = delimiter;
      }
    } catch {
      // The full parse below owns syntax validation. This pass only retains
      // enough header evidence to avoid falling back to comma after an error.
    }

    let records: string[][];
    try {
      records = parseCsvRecords(sample, delimiter, 32).filter(
        (record) => !isPhysicalBlankRecord(record),
      );
    } catch {
      continue;
    }

    if (records.length === 0) continue;
    // A real table delimiter must split the header. This prevents commas in
    // semicolon-delimited numeric values from winning the consistency score.
    if (records[0].length <= 1) continue;

    const widthFrequency = new Map<number, number>();
    for (const record of records) {
      widthFrequency.set(
        record.length,
        (widthFrequency.get(record.length) ?? 0) + 1,
      );
    }

    let modalWidth = 1;
    let modalFrequency = 0;
    for (const [width, frequency] of widthFrequency) {
      if (
        frequency > modalFrequency ||
        (frequency === modalFrequency && width > modalWidth)
      ) {
        modalWidth = width;
        modalFrequency = frequency;
      }
    }

    if (modalWidth <= 1) continue;

    const inconsistentRows = records.length - modalFrequency;
    const score = modalFrequency * 100 + modalWidth * 10 - inconsistentRows * 25;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestScore === Number.NEGATIVE_INFINITY ? headerFallback : bestDelimiter;
}

function normalizeExcelValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (part: number, length = 2) => String(part).padStart(length, "0");
    const date = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const hasTime =
      value.getHours() !== 0 ||
      value.getMinutes() !== 0 ||
      value.getSeconds() !== 0 ||
      value.getMilliseconds() !== 0;
    if (!hasTime) return date;
    const milliseconds = value.getMilliseconds()
      ? `.${pad(value.getMilliseconds(), 3)}`
      : "";
    return `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}${milliseconds}`;
  }
  return String(value);
}

function matrixToDataSet(
  matrix: readonly (readonly (CellValue | undefined)[])[],
  options: MatrixDataSetOptions,
): DataSet {
  const copiedMatrix = matrix.map((row) => [...row]);
  const sourceHeaders = copiedMatrix[0] ?? [];

  if (!hasUsableHeader(sourceHeaders)) {
    throw new FileImportError(
      "missing-header",
      `「${options.name}」に使用できるヘッダー行がありません。`,
    );
  }

  const width = copiedMatrix.reduce(
    (largest, row) => Math.max(largest, row.length),
    sourceHeaders.length,
  );
  const headers = makeUniqueHeaders(
    sourceHeaders,
    width,
    options.trimHeaders ?? true,
  );
  const rows: DataRow[] = [];

  for (const sourceRow of copiedMatrix.slice(1)) {
    if ((options.skipEmptyLines ?? true) && isEmptyDataRecord(sourceRow)) continue;

    const row = {
      [ROW_ID_KEY]: `${options.id}-row-${rows.length + 1}`,
    } as DataRow;
    headers.forEach((header, columnIndex) => {
      // Preserve the parsed source value. Reconciliation normalization must
      // produce separate comparison values rather than mutating this row.
      row[header] = sourceRow[columnIndex] ?? null;
    });
    rows.push(row);
  }

  return {
    id: options.id,
    name: options.name,
    headers,
    rows,
  };
}

export function parseCsv(
  source: string,
  options: CsvParseOptions = {},
): CsvParseResult {
  const text = source.replace(/^\uFEFF/u, "");
  if (text.length === 0 || text.trim().length === 0) {
    throw new FileImportError("empty-file", "CSVファイルが空です。");
  }

  const delimiter = options.delimiter ?? detectCsvDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  const filteredRecords = (options.skipEmptyLines ?? true)
    ? records.filter((record) => !isPhysicalBlankRecord(record))
    : records;
  const name = options.dataSetName ?? "CSV";
  const id = options.dataSetId ?? stableId(name);

  return {
    delimiter,
    dataSet: matrixToDataSet(filteredRecords, {
      id,
      name,
      skipEmptyLines: options.skipEmptyLines,
      trimHeaders: options.trimHeaders,
    }),
  };
}

export const parseCsvText = parseCsv;

/** UTF-8 is accepted only when fatal decoding succeeds; otherwise Shift-JIS is used. */
export async function decodeCsvBuffer(
  input: BinaryInput,
): Promise<CsvDecodeResult> {
  const bytes = toBytes(input);
  const hadBom = isUtf8Bom(bytes);
  const content = hadBom ? bytes.slice(UTF8_BOM.length) : bytes;

  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(content),
      encoding: "utf-8",
      hadBom,
    };
  } catch {
    const Encoding = await loadEncodingJapanese();
    const unicodeCodes = Encoding.convert(Array.from(content), {
      from: "SJIS",
      to: "UNICODE",
      type: "array",
    });
    return {
      text: Encoding.codeToString(unicodeCodes),
      encoding: "shift-jis",
      hadBom: false,
    };
  }
}

export function detectSupportedFileType(file: FileInfo): SupportedFileType {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "xlsx") return extension;

  // An explicitly unsupported extension wins over a generic MIME type. This
  // prevents legacy XLS files from being presented as supported.
  if (file.name.includes(".")) {
    throw new FileImportError(
      "unsupported-format",
      `対応していないファイル形式です: ${file.name || "(ファイル名なし)"}。CSVまたはXLSXを選択してください。`,
    );
  }

  const mimeType = file.type?.toLowerCase() ?? "";
  if (mimeType === "text/csv" || mimeType.includes("/csv")) return "csv";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }

  throw new FileImportError(
    "unsupported-format",
    `対応していないファイル形式です: ${file.name || "(ファイル名なし)"}。CSVまたはXLSXを選択してください。`,
  );
}

function assertAcceptedSize(file: FileInfo, actualSize?: number): void {
  const reportedSize = file.size;
  const effectiveSize = Math.max(reportedSize ?? 0, actualSize ?? 0);

  if (effectiveSize > MAX_FILE_SIZE_BYTES) {
    throw new FileImportError(
      "file-too-large",
      `ファイルサイズが25 MiBを超えています: ${file.name || "(ファイル名なし)"}`,
    );
  }
  if (actualSize === 0 || (actualSize === undefined && reportedSize === 0)) {
    throw new FileImportError(
      "empty-file",
      `ファイルが空です: ${file.name || "(ファイル名なし)"}`,
    );
  }
}

function createMetadata(
  file: FileInfo,
  fileType: SupportedFileType,
  inputSize: number,
  dataSets: readonly DataSet[],
  encoding: FileEncoding,
  options: {
    delimiter?: CsvDelimiter;
    skippedSheetNames?: string[];
  } = {},
): ImportedFileMetadata {
  return {
    fileName: file.name,
    fileType,
    fileSize: file.size ?? inputSize,
    rowCount: dataSets.reduce((total, dataSet) => total + dataSet.rows.length, 0),
    columnCount: dataSets.reduce(
      (largest, dataSet) => Math.max(largest, dataSet.headers.length),
      0,
    ),
    sheetNames: fileType === "csv" ? [] : dataSets.map((dataSet) => dataSet.name),
    activeSheet: fileType === "csv" ? undefined : dataSets[0]?.name,
    encoding,
    ...(options.delimiter ? { delimiter: options.delimiter } : {}),
    ...(options.skippedSheetNames?.length
      ? { skippedSheetNames: options.skippedSheetNames }
      : {}),
  };
}

function withSourceMetadata(
  dataSet: DataSet,
  metadata: ImportedFileMetadata,
  activeSheet?: string,
): DataSet {
  return {
    ...dataSet,
    metadata: {
      ...dataSet.metadata,
      source: {
        ...metadata,
        rowCount: dataSet.rows.length,
        columnCount: dataSet.headers.length,
        ...(activeSheet ? { activeSheet } : {}),
      },
    },
  };
}

async function readCsv(
  input: BinaryInput,
  file: FileInfo,
): Promise<ImportedTabularFile> {
  const decoded = await decodeCsvBuffer(input);
  const name = stripSupportedExtension(file.name) || "CSV";
  const parsed = parseCsv(decoded.text, {
    dataSetId: stableId(`${file.name}:CSV`),
    dataSetName: name,
  });
  const metadata = createMetadata(
    file,
    "csv",
    byteLength(input),
    [parsed.dataSet],
    decoded.encoding,
    { delimiter: parsed.delimiter },
  );
  const dataSet = withSourceMetadata(parsed.dataSet, metadata);

  return { dataSet, dataSets: [dataSet], metadata };
}

async function readWorkbook(
  input: BinaryInput,
  file: FileInfo,
): Promise<ImportedTabularFile> {
  let xlsx: XlsxModule;
  let workbook: ReturnType<XlsxModule["read"]>;

  try {
    xlsx = await loadXlsx();
    workbook = xlsx.read(toBytes(input), {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: true,
    });
  } catch (error) {
    throw new FileImportError(
      "xlsx-parse-error",
      `Excelファイルを解析できませんでした: ${file.name}`,
      { cause: error },
    );
  }

  if (workbook.SheetNames.length === 0) {
    throw new FileImportError(
      "no-usable-sheet",
      "Excelファイルにシートがありません。",
    );
  }

  const dataSets: DataSet[] = [];
  const skippedSheetNames: string[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawMatrix = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    const matrix = rawMatrix.map((row) => row.map(normalizeExcelValue));

    try {
      dataSets.push(
        matrixToDataSet(matrix, {
          id: stableId(`${file.name}:${sheetIndex}:${sheetName}`),
          name: sheetName,
        }),
      );
    } catch (error) {
      if (error instanceof FileImportError && error.code === "missing-header") {
        skippedSheetNames.push(sheetName);
        return;
      }
      throw error;
    }
  });

  if (dataSets.length === 0) {
    throw new FileImportError(
      "no-usable-sheet",
      "Excelファイルに使用できるヘッダーを持つシートがありません。",
    );
  }

  const metadata = createMetadata(
    file,
    "xlsx",
    byteLength(input),
    dataSets,
    "binary",
    { skippedSheetNames },
  );
  const enrichedDataSets = dataSets.map((dataSet) =>
    withSourceMetadata(dataSet, metadata, dataSet.name),
  );

  return {
    dataSet: enrichedDataSets[0],
    dataSets: enrichedDataSets,
    metadata,
  };
}

/** Import CSV/XLSX bytes entirely in the current browser or Web Worker. */
export async function readDataFile(
  input: BinaryInput,
  file: FileInfo,
): Promise<ImportedTabularFile> {
  const fileType = detectSupportedFileType(file);
  assertAcceptedSize(file, byteLength(input));
  return fileType === "csv" ? readCsv(input, file) : readWorkbook(input, file);
}

export const importDataFile = readDataFile;

/** Browser adapter that rejects oversized/empty files before reading bytes. */
export async function readBrowserFile(
  file: BrowserFileLike,
): Promise<ImportedTabularFile> {
  detectSupportedFileType(file);
  assertAcceptedSize(file);
  return readDataFile(await file.arrayBuffer(), file);
}

export const importBrowserFile = readBrowserFile;
