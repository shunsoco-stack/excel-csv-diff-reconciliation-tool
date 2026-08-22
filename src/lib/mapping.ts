import {
  validateReconciliationConfig,
  type ColumnMapping,
  type ReconciliationConfig,
} from "./reconciliation";
import type { DataSet } from "./types";

export interface MappingSuggestion {
  baselineColumn: string;
  comparisonColumn: string;
  score: number;
  reason: "exact" | "normalized" | "similar";
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s_\-./\\()（）\[\]【】]+/gu, "");
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      );
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function headerSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const normalizedLeft = normalizeHeader(left);
  const normalizedRight = normalizeHeader(right);
  if (normalizedLeft === normalizedRight) return 0.98;
  const longest = Math.max(normalizedLeft.length, normalizedRight.length, 1);
  return Math.max(0, 1 - levenshtein(normalizedLeft, normalizedRight) / longest);
}

export function suggestColumnMappings(
  baselineHeaders: readonly string[],
  comparisonHeaders: readonly string[],
): MappingSuggestion[] {
  return baselineHeaders.flatMap((baselineColumn) => {
    const ranked = comparisonHeaders
      .map((comparisonColumn) => ({
        comparisonColumn,
        score: headerSimilarity(baselineColumn, comparisonColumn),
      }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score < 0.42) return [];
    return [{
      baselineColumn,
      comparisonColumn: best.comparisonColumn,
      score: best.score,
      reason: baselineColumn === best.comparisonColumn
        ? "exact"
        : best.score >= 0.98
          ? "normalized"
          : "similar",
    } satisfies MappingSuggestion];
  });
}

function mappingId(index: number): string {
  return `mapping-${index + 1}`;
}

/** Exact names are safe defaults. Fuzzy/normalized matches remain suggestions until applied. */
export function createInitialConfig(
  baseline: DataSet,
  comparison: DataSet,
): ReconciliationConfig {
  const mappings: ColumnMapping[] = [];
  baseline.headers.forEach((baselineColumn, index) => {
    if (!comparison.headers.includes(baselineColumn)) return;
    mappings.push({
      id: mappingId(index),
      label: baselineColumn,
      baselineColumn,
      comparisonColumn: baselineColumn,
    });
  });
  return {
    version: 1,
    mappings,
    keyMappingIds: [],
    compareMappingIds: mappings.map((mapping) => mapping.id),
    normalization: {
      trim: true,
      caseInsensitive: false,
      width: "none",
      lineBreaks: "lf",
      emptyAsNull: true,
      valueType: "text",
    },
  };
}

/** Returns the user-facing reason why the current setup cannot be compared. */
export function getReconciliationConfigIssue(
  baseline: DataSet,
  comparison: DataSet,
  config: ReconciliationConfig,
): string | null {
  if (
    !Array.isArray(config.compareMappingIds) ||
    config.compareMappingIds.length === 0
  ) {
    return "比較対象列を1件以上設定してください。";
  }

  try {
    validateReconciliationConfig(baseline, comparison, config);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "照合条件を確認してください。";
  }
}

export function getMappingIdForBaselineColumn(
  baselineHeaders: readonly string[],
  baselineColumn: string,
): string {
  return mappingId(Math.max(0, baselineHeaders.indexOf(baselineColumn)));
}

export function isLikelyKeyColumn(header: string): boolean {
  const value = normalizeHeader(header);
  return /(^|customer|product|store|order|item)(id|code|number|no|sku)$|メール|email|コード|番号|id$/iu.test(value);
}
