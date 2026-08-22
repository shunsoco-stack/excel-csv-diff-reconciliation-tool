import {
  ROW_ID_KEY,
  type CellValue,
  type DataRow,
  type DataSet,
} from "./types";

export type DataSide = "baseline" | "comparison";

export type ReconciliationStatus =
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export type ResultFilterStatus =
  | ReconciliationStatus
  | "duplicate"
  | "error";

export interface ColumnMapping {
  id: string;
  label: string;
  baselineColumn: string;
  comparisonColumn: string;
}

export interface NormalizationOptions {
  trim: boolean;
  caseInsensitive: boolean;
  width: "none" | "half" | "full";
  lineBreaks: "preserve" | "lf" | "space";
  emptyAsNull: boolean;
  valueType: "text" | "number" | "date";
}

export interface ReconciliationConfig {
  version: 1;
  mappings: ColumnMapping[];
  keyMappingIds: string[];
  compareMappingIds: string[];
  normalization: NormalizationOptions;
  normalizationByMappingId?: Record<string, Partial<NormalizationOptions>>;
}

export interface RowPointer {
  rowId: string;
  rowIndex: number;
}

export interface CellDiff {
  mappingId: string;
  label: string;
  baselineColumn: string;
  comparisonColumn: string;
  /** Original source value. Normalization never replaces this value. */
  before: CellValue;
  /** Original source value. Normalization never replaces this value. */
  after: CellValue;
}

export interface ReconciledRecord {
  status: ReconciliationStatus;
  keyToken: string;
  keyDisplay: string;
  keyValues: CellValue[];
  baseline?: RowPointer;
  comparison?: RowPointer;
  changes: CellDiff[];
}

export interface DuplicateGroup {
  keyToken: string;
  keyDisplay: string;
  keyValues: CellValue[];
  duplicateSides: DataSide[];
  /** Includes a unique counterpart because the whole normalized key is ambiguous. */
  baselineRows: RowPointer[];
  /** Includes a unique counterpart because the whole normalized key is ambiguous. */
  comparisonRows: RowPointer[];
}

export type RowIssueReason = "missing-key" | "normalization-error";

export interface RowIssue {
  side: DataSide;
  row: RowPointer;
  reason: RowIssueReason;
  mappingIds: string[];
  keyDisplay: string;
  message: string;
}

export interface ReconciliationSummary {
  baselineRows: number;
  comparisonRows: number;
  /** Resolvable union of keys; duplicate and error rows are excluded. */
  totalRecords: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  duplicateKeys: number;
  /** Rows on the baseline side where the normalized key occurs more than once. */
  duplicateBaselineRows: number;
  /** Rows on the comparison side where the normalized key occurs more than once. */
  duplicateComparisonRows: number;
  /** All rows quarantined by a duplicate key, including unique counterparts. */
  ambiguousRows: number;
  missingKeyRows: number;
  normalizationErrorRows: number;
  /** Unique source rows represented by one or more errors. */
  errorRows: number;
  differenceRate: number;
  matchRate: number;
}

export interface ReconciliationResult {
  records: ReconciledRecord[];
  duplicates: DuplicateGroup[];
  errors: RowIssue[];
  summary: ReconciliationSummary;
}

export interface NormalizedCellValue {
  kind: "empty" | "null" | "text" | "number" | "date" | "invalid";
  value: string | null;
  /** Type-tagged, collision-safe representation used only for equality. */
  token: string;
  valid: boolean;
  error?: string;
}

export type ReconciliationConfigErrorCode =
  | "unsupported-version"
  | "invalid-mapping"
  | "duplicate-mapping"
  | "missing-column"
  | "invalid-key"
  | "invalid-comparison"
  | "invalid-normalization";

export class ReconciliationConfigError extends Error {
  readonly code: ReconciliationConfigErrorCode;

  constructor(code: ReconciliationConfigErrorCode, message: string) {
    super(message);
    this.name = "ReconciliationConfigError";
    this.code = code;
  }
}

export const DEFAULT_NORMALIZATION_OPTIONS: Readonly<NormalizationOptions> = {
  trim: false,
  caseInsensitive: false,
  width: "none",
  lineBreaks: "lf",
  emptyAsNull: true,
  valueType: "text",
};

const KANA_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["。", "｡"], ["「", "｢"], ["」", "｣"], ["、", "､"], ["・", "･"],
  ["ヲ", "ｦ"], ["ァ", "ｧ"], ["ィ", "ｨ"], ["ゥ", "ｩ"], ["ェ", "ｪ"], ["ォ", "ｫ"],
  ["ャ", "ｬ"], ["ュ", "ｭ"], ["ョ", "ｮ"], ["ッ", "ｯ"], ["ー", "ｰ"],
  ["ア", "ｱ"], ["イ", "ｲ"], ["ウ", "ｳ"], ["エ", "ｴ"], ["オ", "ｵ"],
  ["カ", "ｶ"], ["キ", "ｷ"], ["ク", "ｸ"], ["ケ", "ｹ"], ["コ", "ｺ"],
  ["サ", "ｻ"], ["シ", "ｼ"], ["ス", "ｽ"], ["セ", "ｾ"], ["ソ", "ｿ"],
  ["タ", "ﾀ"], ["チ", "ﾁ"], ["ツ", "ﾂ"], ["テ", "ﾃ"], ["ト", "ﾄ"],
  ["ナ", "ﾅ"], ["ニ", "ﾆ"], ["ヌ", "ﾇ"], ["ネ", "ﾈ"], ["ノ", "ﾉ"],
  ["ハ", "ﾊ"], ["ヒ", "ﾋ"], ["フ", "ﾌ"], ["ヘ", "ﾍ"], ["ホ", "ﾎ"],
  ["マ", "ﾏ"], ["ミ", "ﾐ"], ["ム", "ﾑ"], ["メ", "ﾒ"], ["モ", "ﾓ"],
  ["ヤ", "ﾔ"], ["ユ", "ﾕ"], ["ヨ", "ﾖ"], ["ラ", "ﾗ"], ["リ", "ﾘ"],
  ["ル", "ﾙ"], ["レ", "ﾚ"], ["ロ", "ﾛ"], ["ワ", "ﾜ"], ["ン", "ﾝ"],
  ["゛", "ﾞ"], ["゜", "ﾟ"],
  ["ガ", "ｶﾞ"], ["ギ", "ｷﾞ"], ["グ", "ｸﾞ"], ["ゲ", "ｹﾞ"], ["ゴ", "ｺﾞ"],
  ["ザ", "ｻﾞ"], ["ジ", "ｼﾞ"], ["ズ", "ｽﾞ"], ["ゼ", "ｾﾞ"], ["ゾ", "ｿﾞ"],
  ["ダ", "ﾀﾞ"], ["ヂ", "ﾁﾞ"], ["ヅ", "ﾂﾞ"], ["デ", "ﾃﾞ"], ["ド", "ﾄﾞ"],
  ["バ", "ﾊﾞ"], ["ビ", "ﾋﾞ"], ["ブ", "ﾌﾞ"], ["ベ", "ﾍﾞ"], ["ボ", "ﾎﾞ"],
  ["パ", "ﾊﾟ"], ["ピ", "ﾋﾟ"], ["プ", "ﾌﾟ"], ["ペ", "ﾍﾟ"], ["ポ", "ﾎﾟ"],
  ["ヴ", "ｳﾞ"],
];

const FULL_TO_HALF_KANA = new Map(KANA_PAIRS);
const HALF_TO_FULL_KANA = new Map(
  KANA_PAIRS.map(([full, half]) => [half, full] as const),
);

export function fullWidthToHalfWidth(value: string): string {
  let result = "";
  for (const character of value) {
    const kana = FULL_TO_HALF_KANA.get(character);
    if (kana) {
      result += kana;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0);
    } else if (character === "　") {
      result += " ";
    } else {
      result += character;
    }
  }
  return result;
}

export function halfWidthToFullWidth(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    const pairedKana = HALF_TO_FULL_KANA.get(pair);
    if (pairedKana) {
      result += pairedKana;
      index += 1;
      continue;
    }
    const character = value[index];
    const kana = HALF_TO_FULL_KANA.get(character);
    if (kana) {
      result += kana;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code >= 0x21 && code <= 0x7e) {
      result += String.fromCharCode(code + 0xfee0);
    } else if (character === " ") {
      result += "　";
    } else {
      result += character;
    }
  }
  return result;
}

function normalizeText(
  value: Exclude<CellValue, null>,
  options: Readonly<NormalizationOptions>,
): string {
  let text = String(value);
  if (options.lineBreaks === "lf") {
    text = text.replace(/\r\n?/gu, "\n");
  } else if (options.lineBreaks === "space") {
    text = text.replace(/\r\n?|\n/gu, " ");
  }
  if (options.width === "half") text = fullWidthToHalfWidth(text);
  if (options.width === "full") text = halfWidthToFullWidth(text);
  if (options.trim) text = text.trim();
  if (options.caseInsensitive) text = text.toLocaleLowerCase("ja-JP");
  return text;
}

function parseComparableNumber(
  source: CellValue,
  normalizedText: string,
): string | null {
  if (typeof source === "number") {
    if (!Number.isFinite(source)) return null;
    return canonicalizeNumberText(String(source), true);
  }
  if (typeof source !== "string") return null;

  let candidate = fullWidthToHalfWidth(normalizedText)
    .trim()
    .replace(/[\s,]/gu, "");
  const percent = candidate.endsWith("%");
  if (percent) candidate = candidate.slice(0, -1);
  candidate = candidate
    .replace(/^[¥￥$€£]/u, "")
    .replace(/円$/u, "");
  const canonical = canonicalizeNumberText(candidate, false);
  if (canonical === null) return null;
  return percent ? shiftDecimalPoint(canonical, -2) : canonical;
}

/**
 * Canonicalizes a decimal without converting source text through IEEE-754.
 * This prevents distinct high-precision CSV values from becoming equal only
 * because JavaScript Number rounds them to the same value.
 */
function canonicalizeNumberText(
  source: string,
  allowExponent: boolean,
): string | null {
  const exponentMatch = allowExponent
    ? source.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/u)
    : null;
  if (exponentMatch) {
    const sign = exponentMatch[1];
    const integer = exponentMatch[2];
    const fraction = exponentMatch[3] ?? "";
    const exponent = Number(exponentMatch[4]);
    if (!Number.isSafeInteger(exponent)) return null;
    const digits = `${integer}${fraction}`;
    const decimalPosition = integer.length + exponent;
    const expanded = decimalPosition <= 0
      ? `0.${"0".repeat(-decimalPosition)}${digits}`
      : decimalPosition >= digits.length
        ? `${digits}${"0".repeat(decimalPosition - digits.length)}`
        : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
    return canonicalizeNumberText(`${sign}${expanded}`, false);
  }

  const match = source.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/u);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/u, "");
  const fraction = (match[3] ?? match[4] ?? "").replace(/0+$/u, "");
  const unsigned = fraction ? `${integer}.${fraction}` : integer;
  return /^0(?:\.0*)?$/u.test(unsigned) ? "0" : `${sign}${unsigned}`;
}

function shiftDecimalPoint(canonical: string, places: number): string {
  const sign = canonical.startsWith("-") ? "-" : "";
  const unsigned = sign ? canonical.slice(1) : canonical;
  const [integer, fraction = ""] = unsigned.split(".");
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + places;
  const shifted = decimalPosition <= 0
    ? `0.${"0".repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${"0".repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return canonicalizeNumberText(`${sign}${shifted}`, false)!;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function isValidDateParts(parts: DateParts): boolean {
  if (!Number.isInteger(parts.year) || parts.year < 1 || parts.year > 9999) return false;
  if (!Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) return false;
  const leapYear = parts.year % 4 === 0
    && (parts.year % 100 !== 0 || parts.year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(parts.day)
    && parts.day >= 1
    && parts.day <= daysByMonth[parts.month - 1];
}

function datePartsFromMatch(match: RegExpMatchArray): DateParts | null {
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValidDateParts(parts) ? parts : null;
}

function excelSerialDateParts(serial: number): DateParts | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const wholeDays = Math.floor(serial);
  // Excel preserves Lotus 1-2-3's fictitious 1900-02-29 as serial 60.
  // Reject that impossible date and use the correct epoch on either side.
  if (wholeDays === 60) return null;
  const epoch = Date.UTC(1899, 11, wholeDays < 60 ? 31 : 30);
  const date = new Date(epoch + wholeDays * 86_400_000);
  const parts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
  return isValidDateParts(parts) ? parts : null;
}

function parseComparableDate(
  source: CellValue,
  normalizedText: string,
): DateParts | null {
  if (typeof source === "number") {
    const compact = String(Math.trunc(source));
    if (Number.isInteger(source) && /^\d{8}$/u.test(compact)) {
      return datePartsFromMatch(compact.match(/^(\d{4})(\d{2})(\d{2})$/u)!);
    }
    return excelSerialDateParts(source);
  }
  if (typeof source !== "string") return null;
  const candidate = fullWidthToHalfWidth(normalizedText).trim();
  const patterns = [
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/u,
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u,
    /^(\d{4})(\d{2})(\d{2})$/u,
    /^(\d{4})年(\d{1,2})月(\d{1,2})日$/u,
  ];
  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (match) return datePartsFromMatch(match);
  }
  return null;
}

function formatDateParts(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Produces a typed comparison token while leaving the source value untouched.
 * Invalid requested number/date coercions are explicitly tagged and never
 * collapse into an empty value or another invalid source representation.
 */
export function normalizeCellValue(
  value: CellValue | undefined,
  options: Readonly<NormalizationOptions> = DEFAULT_NORMALIZATION_OPTIONS,
): NormalizedCellValue {
  if (value === null || value === undefined) {
    return options.emptyAsNull
      ? { kind: "empty", value: null, token: JSON.stringify(["empty"]), valid: true }
      : { kind: "null", value: null, token: JSON.stringify(["null"]), valid: true };
  }

  const text = normalizeText(value, options);
  if (text === "") {
    return options.emptyAsNull
      ? { kind: "empty", value: null, token: JSON.stringify(["empty"]), valid: true }
      : { kind: "text", value: "", token: JSON.stringify(["text", ""]), valid: true };
  }

  if (options.valueType === "number") {
    const parsed = parseComparableNumber(value, text);
    if (parsed === null) {
      return {
        kind: "invalid",
        value: text,
        token: JSON.stringify(["invalid-number", text]),
        valid: false,
        error: "数値として正規化できません。",
      };
    }
    return {
      kind: "number",
      value: parsed,
      token: JSON.stringify(["number", parsed]),
      valid: true,
    };
  }

  if (options.valueType === "date") {
    const parsed = parseComparableDate(value, text);
    if (!parsed) {
      return {
        kind: "invalid",
        value: text,
        token: JSON.stringify(["invalid-date", text]),
        valid: false,
        error: "日付として正規化できません。",
      };
    }
    const canonical = formatDateParts(parsed);
    return {
      kind: "date",
      value: canonical,
      token: JSON.stringify(["date", canonical]),
      valid: true,
    };
  }

  return {
    kind: "text",
    value: text,
    token: JSON.stringify(["text", text]),
    valid: true,
  };
}

interface ResolvedConfig {
  mappingsById: Map<string, ColumnMapping>;
  keyMappings: ColumnMapping[];
  compareMappings: ColumnMapping[];
  normalizationById: Map<string, NormalizationOptions>;
}

function normalizationError(message: string): never {
  throw new ReconciliationConfigError("invalid-normalization", message);
}

function validateNormalization(
  value: Partial<NormalizationOptions> | undefined,
  label: string,
  requireEveryField: boolean,
): void {
  if (!value || typeof value !== "object") {
    normalizationError(`${label}が不正です。`);
  }
  const required: Array<keyof NormalizationOptions> = [
    "trim",
    "caseInsensitive",
    "width",
    "lineBreaks",
    "emptyAsNull",
    "valueType",
  ];
  if (requireEveryField && required.some((key) => value[key] === undefined)) {
    normalizationError(`${label}の必須項目が不足しています。`);
  }
  if (value.trim !== undefined && typeof value.trim !== "boolean") {
    normalizationError(`${label}のtrim設定が不正です。`);
  }
  if (value.caseInsensitive !== undefined && typeof value.caseInsensitive !== "boolean") {
    normalizationError(`${label}の大文字・小文字設定が不正です。`);
  }
  if (value.emptyAsNull !== undefined && typeof value.emptyAsNull !== "boolean") {
    normalizationError(`${label}の空欄設定が不正です。`);
  }
  if (value.width !== undefined && !["none", "half", "full"].includes(value.width)) {
    normalizationError(`${label}の全角・半角設定が不正です。`);
  }
  if (value.lineBreaks !== undefined && !["preserve", "lf", "space"].includes(value.lineBreaks)) {
    normalizationError(`${label}の改行設定が不正です。`);
  }
  if (value.valueType !== undefined && !["text", "number", "date"].includes(value.valueType)) {
    normalizationError(`${label}の値形式が不正です。`);
  }
}

function resolveConfig(
  baseline: DataSet,
  comparison: DataSet,
  config: ReconciliationConfig,
): ResolvedConfig {
  if (config.version !== 1) {
    throw new ReconciliationConfigError(
      "unsupported-version",
      `未対応の照合設定バージョンです: ${String(config.version)}`,
    );
  }
  if (!Array.isArray(config.mappings) || config.mappings.length === 0) {
    throw new ReconciliationConfigError("invalid-mapping", "列Mappingを1件以上設定してください。");
  }
  validateNormalization(config.normalization, "共通の正規化設定", true);

  const mappingsById = new Map<string, ColumnMapping>();
  const baselineColumns = new Set<string>();
  const comparisonColumns = new Set<string>();
  for (const mapping of config.mappings) {
    if (!mapping.id?.trim() || !mapping.label?.trim()) {
      throw new ReconciliationConfigError("invalid-mapping", "列MappingのIDと表示名を入力してください。");
    }
    if (mappingsById.has(mapping.id)) {
      throw new ReconciliationConfigError("duplicate-mapping", `Mapping IDが重複しています: ${mapping.id}`);
    }
    if (baselineColumns.has(mapping.baselineColumn)) {
      throw new ReconciliationConfigError(
        "duplicate-mapping",
        `基準列が複数回Mappingされています: ${mapping.baselineColumn}`,
      );
    }
    if (comparisonColumns.has(mapping.comparisonColumn)) {
      throw new ReconciliationConfigError(
        "duplicate-mapping",
        `比較列が複数回Mappingされています: ${mapping.comparisonColumn}`,
      );
    }
    if (!baseline.headers.includes(mapping.baselineColumn)) {
      throw new ReconciliationConfigError("missing-column", `基準データに列がありません: ${mapping.baselineColumn}`);
    }
    if (!comparison.headers.includes(mapping.comparisonColumn)) {
      throw new ReconciliationConfigError("missing-column", `比較データに列がありません: ${mapping.comparisonColumn}`);
    }
    mappingsById.set(mapping.id, mapping);
    baselineColumns.add(mapping.baselineColumn);
    comparisonColumns.add(mapping.comparisonColumn);
  }

  if (!Array.isArray(config.keyMappingIds) || config.keyMappingIds.length === 0) {
    throw new ReconciliationConfigError("invalid-key", "照合Keyを1件以上設定してください。");
  }
  if (new Set(config.keyMappingIds).size !== config.keyMappingIds.length) {
    throw new ReconciliationConfigError("invalid-key", "同じ照合Keyが複数回設定されています。");
  }
  if (!Array.isArray(config.compareMappingIds)) {
    throw new ReconciliationConfigError("invalid-comparison", "比較対象列の設定が不正です。");
  }
  if (new Set(config.compareMappingIds).size !== config.compareMappingIds.length) {
    throw new ReconciliationConfigError("invalid-comparison", "同じ比較対象列が複数回設定されています。");
  }

  const keyMappings = config.keyMappingIds.map((id) => {
    const mapping = mappingsById.get(id);
    if (!mapping) {
      throw new ReconciliationConfigError("invalid-key", `照合KeyのMappingが見つかりません: ${id}`);
    }
    return mapping;
  });
  const keyIds = new Set(config.keyMappingIds);
  const compareMappings = config.compareMappingIds.map((id) => {
    const mapping = mappingsById.get(id);
    if (!mapping) {
      throw new ReconciliationConfigError("invalid-comparison", `比較対象のMappingが見つかりません: ${id}`);
    }
    if (keyIds.has(id)) {
      throw new ReconciliationConfigError("invalid-comparison", `照合Keyを比較対象列に重複指定できません: ${id}`);
    }
    return mapping;
  });

  const overrides = config.normalizationByMappingId ?? {};
  for (const [id, override] of Object.entries(overrides)) {
    if (!mappingsById.has(id)) {
      throw new ReconciliationConfigError("invalid-normalization", `正規化対象のMappingが見つかりません: ${id}`);
    }
    validateNormalization(override, `Mapping「${id}」の正規化設定`, false);
  }
  const normalizationById = new Map<string, NormalizationOptions>();
  for (const mapping of config.mappings) {
    normalizationById.set(mapping.id, {
      ...config.normalization,
      ...(overrides[mapping.id] ?? {}),
    });
  }

  return { mappingsById, keyMappings, compareMappings, normalizationById };
}

/** Throws a coded error for an invalid or stale mapping/template. */
export function validateReconciliationConfig(
  baseline: DataSet,
  comparison: DataSet,
  config: ReconciliationConfig,
): void {
  resolveConfig(baseline, comparison, config);
}

function pointer(row: DataRow, rowIndex: number): RowPointer {
  return { rowId: row[ROW_ID_KEY], rowIndex };
}

function sourceColumn(mapping: ColumnMapping, side: DataSide): string {
  return side === "baseline" ? mapping.baselineColumn : mapping.comparisonColumn;
}

function rawCell(row: DataRow, column: string): CellValue {
  return row[column] ?? null;
}

function displayKeyValue(value: CellValue): string {
  if (value === null || value === "") return "（空欄）";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function displayKey(mappings: readonly ColumnMapping[], values: readonly CellValue[]): string {
  if (mappings.length === 1) return displayKeyValue(values[0] ?? null);
  return mappings
    .map((mapping, index) => `${mapping.label}: ${displayKeyValue(values[index] ?? null)}`)
    .join(" / ");
}

class IssueCollector {
  private readonly issues = new Map<string, RowIssue>();

  add(
    side: DataSide,
    row: RowPointer,
    reason: RowIssueReason,
    mappingIds: readonly string[],
    keyDisplay: string,
  ): void {
    if (mappingIds.length === 0) return;
    const issueKey = `${side}:${row.rowIndex}:${reason}`;
    const existing = this.issues.get(issueKey);
    if (existing) {
      existing.mappingIds = [...new Set([...existing.mappingIds, ...mappingIds])];
      return;
    }
    const sideLabel = side === "baseline" ? "基準" : "比較";
    const reasonLabel = reason === "missing-key" ? "照合Keyが空欄です" : "正規化できない値があります";
    this.issues.set(issueKey, {
      side,
      row,
      reason,
      mappingIds: [...mappingIds],
      keyDisplay,
      message: `${sideLabel}データ ${row.rowIndex + 1}行目: ${reasonLabel}。`,
    });
  }

  toSortedArray(): RowIssue[] {
    const sideOrder: Record<DataSide, number> = { baseline: 0, comparison: 1 };
    const reasonOrder: Record<RowIssueReason, number> = { "missing-key": 0, "normalization-error": 1 };
    return [...this.issues.values()].sort((left, right) =>
      sideOrder[left.side] - sideOrder[right.side]
      || left.row.rowIndex - right.row.rowIndex
      || reasonOrder[left.reason] - reasonOrder[right.reason],
    );
  }
}

interface IndexedRow {
  row: DataRow;
  pointer: RowPointer;
  keyToken: string;
  keyDisplay: string;
  keyValues: CellValue[];
}

interface SideIndex {
  ordered: IndexedRow[];
  byKey: Map<string, IndexedRow[]>;
}

function isMissingKeyPart(value: CellValue, normalized: NormalizedCellValue): boolean {
  return value === null
    || normalized.kind === "empty"
    || (normalized.kind === "text" && normalized.value === "");
}

function indexDataSet(
  dataSet: DataSet,
  side: DataSide,
  resolved: ResolvedConfig,
  issues: IssueCollector,
): SideIndex {
  const ordered: IndexedRow[] = [];
  const byKey = new Map<string, IndexedRow[]>();
  const seenRowIds = new Set<string>();

  dataSet.rows.forEach((row, rowIndex) => {
    const rowPointer = pointer(row, rowIndex);
    if (!rowPointer.rowId || seenRowIds.has(rowPointer.rowId)) {
      throw new ReconciliationConfigError(
        "invalid-mapping",
        `${side === "baseline" ? "基準" : "比較"}データの内部行IDが空欄または重複しています。`,
      );
    }
    seenRowIds.add(rowPointer.rowId);

    const keyValues: CellValue[] = [];
    const keyTokens: string[] = [];
    const missingMappingIds: string[] = [];
    const invalidMappingIds: string[] = [];
    for (const mapping of resolved.keyMappings) {
      const value = rawCell(row, sourceColumn(mapping, side));
      const normalized = normalizeCellValue(
        value,
        resolved.normalizationById.get(mapping.id)!,
      );
      keyValues.push(value);
      keyTokens.push(normalized.token);
      if (isMissingKeyPart(value, normalized)) missingMappingIds.push(mapping.id);
      else if (!normalized.valid) invalidMappingIds.push(mapping.id);
    }

    const keyDisplay = displayKey(resolved.keyMappings, keyValues);
    issues.add(side, rowPointer, "missing-key", missingMappingIds, keyDisplay);
    issues.add(side, rowPointer, "normalization-error", invalidMappingIds, keyDisplay);
    if (missingMappingIds.length > 0 || invalidMappingIds.length > 0) return;

    // JSON tuple serialization prevents collisions when real values contain a
    // separator such as `|`, commas, or the display separator itself.
    const keyToken = JSON.stringify(keyTokens);
    const indexed = { row, pointer: rowPointer, keyToken, keyDisplay, keyValues };
    ordered.push(indexed);
    const group = byKey.get(keyToken);
    if (group) group.push(indexed);
    else byKey.set(keyToken, [indexed]);
  });

  return { ordered, byKey };
}

function collectDuplicateKeys(baseline: SideIndex, comparison: SideIndex): Set<string> {
  const duplicateKeys = new Set<string>();
  for (const [key, rows] of baseline.byKey) {
    if (rows.length > 1) duplicateKeys.add(key);
  }
  for (const [key, rows] of comparison.byKey) {
    if (rows.length > 1) duplicateKeys.add(key);
  }
  return duplicateKeys;
}

function buildDuplicateGroups(
  baseline: SideIndex,
  comparison: SideIndex,
  duplicateKeys: ReadonlySet<string>,
): DuplicateGroup[] {
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const indexed of [...baseline.ordered, ...comparison.ordered]) {
    if (duplicateKeys.has(indexed.keyToken) && !seen.has(indexed.keyToken)) {
      seen.add(indexed.keyToken);
      orderedKeys.push(indexed.keyToken);
    }
  }
  return orderedKeys.map((keyToken) => {
    const baselineRows = baseline.byKey.get(keyToken) ?? [];
    const comparisonRows = comparison.byKey.get(keyToken) ?? [];
    const representative = baselineRows[0] ?? comparisonRows[0];
    const duplicateSides: DataSide[] = [];
    if (baselineRows.length > 1) duplicateSides.push("baseline");
    if (comparisonRows.length > 1) duplicateSides.push("comparison");
    return {
      keyToken,
      keyDisplay: representative.keyDisplay,
      keyValues: [...representative.keyValues],
      duplicateSides,
      baselineRows: baselineRows.map((item) => item.pointer),
      comparisonRows: comparisonRows.map((item) => item.pointer),
    };
  });
}

function compareIndexedRows(
  baseline: IndexedRow,
  comparison: IndexedRow,
  resolved: ResolvedConfig,
  issues: IssueCollector,
): CellDiff[] {
  const changes: CellDiff[] = [];
  for (const mapping of resolved.compareMappings) {
    const before = rawCell(baseline.row, mapping.baselineColumn);
    const after = rawCell(comparison.row, mapping.comparisonColumn);
    const normalization = resolved.normalizationById.get(mapping.id)!;
    const normalizedBefore = normalizeCellValue(before, normalization);
    const normalizedAfter = normalizeCellValue(after, normalization);
    if (!normalizedBefore.valid) {
      issues.add("baseline", baseline.pointer, "normalization-error", [mapping.id], baseline.keyDisplay);
    }
    if (!normalizedAfter.valid) {
      issues.add("comparison", comparison.pointer, "normalization-error", [mapping.id], comparison.keyDisplay);
    }
    if (normalizedBefore.token !== normalizedAfter.token) {
      changes.push({
        mappingId: mapping.id,
        label: mapping.label,
        baselineColumn: mapping.baselineColumn,
        comparisonColumn: mapping.comparisonColumn,
        before,
        after,
      });
    }
  }
  return changes;
}

function summarize(
  baseline: DataSet,
  comparison: DataSet,
  records: readonly ReconciledRecord[],
  duplicates: readonly DuplicateGroup[],
  errors: readonly RowIssue[],
): ReconciliationSummary {
  const counts: Record<ReconciliationStatus, number> = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
  };
  for (const record of records) counts[record.status] += 1;
  const totalRecords = records.length;
  const differenceCount = counts.added + counts.removed + counts.changed;
  const errorRowKeys = new Set(errors.map((issue) => `${issue.side}:${issue.row.rowIndex}`));
  return {
    baselineRows: baseline.rows.length,
    comparisonRows: comparison.rows.length,
    totalRecords,
    added: counts.added,
    removed: counts.removed,
    changed: counts.changed,
    unchanged: counts.unchanged,
    duplicateKeys: duplicates.length,
    duplicateBaselineRows: duplicates.reduce(
      (total, group) => total + (group.duplicateSides.includes("baseline") ? group.baselineRows.length : 0),
      0,
    ),
    duplicateComparisonRows: duplicates.reduce(
      (total, group) => total + (group.duplicateSides.includes("comparison") ? group.comparisonRows.length : 0),
      0,
    ),
    ambiguousRows: duplicates.reduce(
      (total, group) => total + group.baselineRows.length + group.comparisonRows.length,
      0,
    ),
    missingKeyRows: errors.filter((issue) => issue.reason === "missing-key").length,
    normalizationErrorRows: errors.filter((issue) => issue.reason === "normalization-error").length,
    errorRows: errorRowKeys.size,
    differenceRate: totalRecords === 0 ? 0 : differenceCount / totalRecords,
    matchRate: totalRecords === 0 ? 0 : counts.unchanged / totalRecords,
  };
}

/**
 * Deterministically reconciles two datasets by normalized key. The algorithm
 * is O(rows × configured columns), preserves source order, and never mutates
 * either input dataset.
 */
export function reconcileDataSets(
  baselineDataSet: DataSet,
  comparisonDataSet: DataSet,
  config: ReconciliationConfig,
): ReconciliationResult {
  const resolved = resolveConfig(baselineDataSet, comparisonDataSet, config);
  const issues = new IssueCollector();
  const baseline = indexDataSet(baselineDataSet, "baseline", resolved, issues);
  const comparison = indexDataSet(comparisonDataSet, "comparison", resolved, issues);
  const duplicateKeys = collectDuplicateKeys(baseline, comparison);
  const duplicates = buildDuplicateGroups(baseline, comparison, duplicateKeys);
  const records: ReconciledRecord[] = [];

  for (const baselineRow of baseline.ordered) {
    if (duplicateKeys.has(baselineRow.keyToken)) continue;
    const comparisonRows = comparison.byKey.get(baselineRow.keyToken);
    const comparisonRow = comparisonRows?.[0];
    if (!comparisonRow) {
      records.push({
        status: "removed",
        keyToken: baselineRow.keyToken,
        keyDisplay: baselineRow.keyDisplay,
        keyValues: [...baselineRow.keyValues],
        baseline: baselineRow.pointer,
        changes: [],
      });
      continue;
    }
    const changes = compareIndexedRows(baselineRow, comparisonRow, resolved, issues);
    records.push({
      status: changes.length === 0 ? "unchanged" : "changed",
      keyToken: baselineRow.keyToken,
      keyDisplay: baselineRow.keyDisplay,
      keyValues: [...baselineRow.keyValues],
      baseline: baselineRow.pointer,
      comparison: comparisonRow.pointer,
      changes,
    });
  }

  for (const comparisonRow of comparison.ordered) {
    if (duplicateKeys.has(comparisonRow.keyToken)) continue;
    if (baseline.byKey.has(comparisonRow.keyToken)) continue;
    records.push({
      status: "added",
      keyToken: comparisonRow.keyToken,
      keyDisplay: comparisonRow.keyDisplay,
      keyValues: [...comparisonRow.keyValues],
      comparison: comparisonRow.pointer,
      changes: [],
    });
  }

  const errors = issues.toSortedArray();
  return {
    records,
    duplicates,
    errors,
    summary: summarize(baselineDataSet, comparisonDataSet, records, duplicates, errors),
  };
}

export type ReconciliationListItem =
  | { kind: "record"; status: ReconciliationStatus; value: ReconciledRecord }
  | { kind: "duplicate"; status: "duplicate"; value: DuplicateGroup }
  | { kind: "error"; status: "error"; value: RowIssue };

export type ReconciliationSort =
  | "source"
  | "key-asc"
  | "key-desc"
  | "changes-asc"
  | "changes-desc";

export interface ReconciliationSelectorOptions {
  statuses?: readonly ResultFilterStatus[];
  /** When set, only changed records containing one of these mappings remain. */
  changedMappingIds?: readonly string[];
  search?: string;
  sort?: ReconciliationSort;
}

function rowFromPointer(dataSet: DataSet, value: RowPointer | undefined): DataRow | undefined {
  if (!value) return undefined;
  const row = dataSet.rows[value.rowIndex];
  return row?.[ROW_ID_KEY] === value.rowId ? row : undefined;
}

function rowSearchValues(dataSet: DataSet, value: RowPointer | undefined): string[] {
  const row = rowFromPointer(dataSet, value);
  return row ? dataSet.headers.map((header) => String(row[header] ?? "")) : [];
}

function normalizeSearch(value: string): string {
  return fullWidthToHalfWidth(value).toLocaleLowerCase("ja-JP").trim();
}

function itemSearchValues(
  item: ReconciliationListItem,
  baseline: DataSet,
  comparison: DataSet,
): string[] {
  if (item.kind === "record") {
    return [
      item.value.keyDisplay,
      ...rowSearchValues(baseline, item.value.baseline),
      ...rowSearchValues(comparison, item.value.comparison),
    ];
  }
  if (item.kind === "duplicate") {
    return [
      item.value.keyDisplay,
      ...item.value.baselineRows.flatMap((row) => rowSearchValues(baseline, row)),
      ...item.value.comparisonRows.flatMap((row) => rowSearchValues(comparison, row)),
    ];
  }
  const source = item.value.side === "baseline" ? baseline : comparison;
  return [
    item.value.keyDisplay,
    item.value.message,
    ...rowSearchValues(source, item.value.row),
  ];
}

function itemKey(item: ReconciliationListItem): string {
  return item.value.keyDisplay;
}

function itemChangeCount(item: ReconciliationListItem): number {
  return item.kind === "record" ? item.value.changes.length : 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Filters and sorts every displayable status without modifying engine output. */
export function selectReconciliationItems(
  result: ReconciliationResult,
  baseline: DataSet,
  comparison: DataSet,
  options: ReconciliationSelectorOptions = {},
): ReconciliationListItem[] {
  const items: ReconciliationListItem[] = [
    ...result.records.map((value): ReconciliationListItem => ({ kind: "record", status: value.status, value })),
    ...result.duplicates.map((value): ReconciliationListItem => ({ kind: "duplicate", status: "duplicate", value })),
    ...result.errors.map((value): ReconciliationListItem => ({ kind: "error", status: "error", value })),
  ];
  const statuses = options.statuses ? new Set(options.statuses) : undefined;
  const changedMappings = options.changedMappingIds?.length
    ? new Set(options.changedMappingIds)
    : undefined;
  const query = options.search ? normalizeSearch(options.search) : "";

  const filtered = items.filter((item) => {
    if (statuses && !statuses.has(item.status)) return false;
    if (changedMappings) {
      if (item.kind !== "record" || item.status !== "changed") return false;
      if (!item.value.changes.some((change) => changedMappings.has(change.mappingId))) return false;
    }
    if (query) {
      return itemSearchValues(item, baseline, comparison)
        .some((value) => normalizeSearch(value).includes(query));
    }
    return true;
  });

  const sort = options.sort ?? "source";
  if (sort === "source") return filtered;
  return filtered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      let order = 0;
      if (sort === "key-asc" || sort === "key-desc") {
        order = compareCodeUnits(itemKey(left.item), itemKey(right.item));
        if (sort === "key-desc") order *= -1;
      } else {
        order = itemChangeCount(left.item) - itemChangeCount(right.item);
        if (sort === "changes-desc") order *= -1;
      }
      return order || left.index - right.index;
    })
    .map(({ item }) => item);
}
