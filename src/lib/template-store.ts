import type {
  ReconciliationConfig,
  ResultFilterStatus,
} from "./reconciliation";
import type { DataSet } from "./types";

export const TEMPLATE_STORAGE_KEY = "reconciliation-templates-v1";

export interface ReconciliationTemplate {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  baselineHeaders: string[];
  comparisonHeaders: string[];
  config: ReconciliationConfig;
  resultFilter: ResultFilterStatus[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTemplate(value: unknown): value is ReconciliationTemplate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReconciliationTemplate>;
  return candidate.version === 1
    && typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string"
    && isStringArray(candidate.baselineHeaders)
    && isStringArray(candidate.comparisonHeaders)
    && Boolean(candidate.config)
    && candidate.config?.version === 1
    && Array.isArray(candidate.config?.mappings)
    && isStringArray(candidate.config?.keyMappingIds)
    && isStringArray(candidate.config?.compareMappingIds)
    && isStringArray(candidate.resultFilter);
}

export function loadTemplates(storage: StorageLike): ReconciliationTemplate[] {
  try {
    const raw = storage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate);
  } catch {
    return [];
  }
}

export function persistTemplates(
  storage: StorageLike,
  templates: readonly ReconciliationTemplate[],
): void {
  storage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

export function createTemplate(
  name: string,
  baseline: DataSet,
  comparison: DataSet,
  config: ReconciliationConfig,
  resultFilter: ResultFilterStatus[],
  now = new Date(),
): ReconciliationTemplate {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("テンプレート名を入力してください。");
  const iso = now.toISOString();
  return {
    version: 1,
    id: `template-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
    createdAt: iso,
    updatedAt: iso,
    baselineHeaders: [...baseline.headers],
    comparisonHeaders: [...comparison.headers],
    config: structuredClone(config),
    resultFilter: [...resultFilter],
  };
}

export function isTemplateCompatible(
  template: ReconciliationTemplate,
  baseline: DataSet,
  comparison: DataSet,
): boolean {
  return template.config.mappings.every((mapping) =>
    baseline.headers.includes(mapping.baselineColumn)
    && comparison.headers.includes(mapping.comparisonColumn),
  );
}

export function upsertTemplate(
  templates: readonly ReconciliationTemplate[],
  template: ReconciliationTemplate,
): ReconciliationTemplate[] {
  const next = templates.filter((item) => item.id !== template.id);
  return [template, ...next];
}

export function removeTemplate(
  templates: readonly ReconciliationTemplate[],
  templateId: string,
): ReconciliationTemplate[] {
  return templates.filter((template) => template.id !== templateId);
}
