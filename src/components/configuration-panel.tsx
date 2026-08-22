"use client";

import {
  Check,
  GitCompareArrows,
  KeyRound,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getMappingIdForBaselineColumn,
  isLikelyKeyColumn,
  suggestColumnMappings,
  type MappingSuggestion,
} from "@/lib/mapping";
import type {
  ColumnMapping,
  NormalizationOptions,
  ReconciliationConfig,
} from "@/lib/reconciliation";
import {
  isTemplateCompatible,
  type ReconciliationTemplate,
} from "@/lib/template-store";
import type { DataSet } from "@/lib/types";

export interface ConfigurationPanelProps {
  baseline: DataSet;
  comparison: DataSet;
  config: ReconciliationConfig;
  onConfigChange: (next: ReconciliationConfig) => void;
  templates: ReconciliationTemplate[];
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onReset: () => void;
  onCompare: () => void;
  isComparing: boolean;
  isStale: boolean;
  canCompare: boolean;
}

type ConfigurationTab = "mapping" | "normalization" | "templates";
type MappingRole = "key" | "compare";

const TABS: ReadonlyArray<{
  id: ConfigurationTab;
  label: string;
}> = [
  { id: "mapping", label: "Mapping" },
  { id: "normalization", label: "Normalization" },
  { id: "templates", label: "Templates" },
];

const SUGGESTION_REASON: Readonly<Record<MappingSuggestion["reason"], string>> = {
  exact: "完全一致",
  normalized: "表記ゆれ",
  similar: "類似候補",
};

const VALUE_TYPE_LABELS: Readonly<Record<NormalizationOptions["valueType"], string>> = {
  text: "文字列",
  number: "数値",
  date: "日付",
};

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function withoutIds(ids: readonly string[], removed: ReadonlySet<string>): string[] {
  return ids.filter((id) => !removed.has(id));
}

function cleanOverrides(
  overrides: ReconciliationConfig["normalizationByMappingId"],
  removedIds: ReadonlySet<string>,
): ReconciliationConfig["normalizationByMappingId"] {
  if (!overrides) return undefined;
  const next = Object.fromEntries(
    Object.entries(overrides).filter(([id]) => !removedIds.has(id)),
  );
  return Object.keys(next).length > 0 ? next : undefined;
}

function replaceId(ids: readonly string[], from: string, to: string): string[] {
  return uniqueIds(ids.map((id) => (id === from ? to : id)));
}

function comparisonColumnUsedByOther(
  ownersByColumn: ReadonlyMap<string, string | null>,
  comparisonColumn: string,
  baselineColumn: string,
): boolean {
  const owner = ownersByColumn.get(comparisonColumn);
  return owner === null || (owner !== undefined && owner !== baselineColumn);
}

function rekeyMapping(
  config: ReconciliationConfig,
  mapping: ColumnMapping,
  stableId: string,
): ReconciliationConfig {
  if (mapping.id === stableId) return config;
  const overrides = { ...(config.normalizationByMappingId ?? {}) };
  if (overrides[mapping.id] !== undefined) {
    overrides[stableId] = overrides[mapping.id];
    delete overrides[mapping.id];
  }
  return {
    ...config,
    mappings: config.mappings.map((item) =>
      item.baselineColumn === mapping.baselineColumn
        ? { ...item, id: stableId }
        : item,
    ),
    keyMappingIds: replaceId(config.keyMappingIds, mapping.id, stableId),
    compareMappingIds: replaceId(config.compareMappingIds, mapping.id, stableId),
    normalizationByMappingId:
      Object.keys(overrides).length > 0 ? overrides : undefined,
  };
}

function templateDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function ConfigurationPanel({
  baseline,
  comparison,
  config,
  onConfigChange,
  templates,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  onReset,
  onCompare,
  isComparing,
  isStale,
  canCompare,
}: ConfigurationPanelProps) {
  const tabSetId = useId();
  const compareHintId = useId();
  const [activeTab, setActiveTab] = useState<ConfigurationTab>("mapping");
  const [templateName, setTemplateName] = useState("");

  const mappingByBaseline = useMemo(
    () =>
      new Map(
        config.mappings.map((mapping) => [mapping.baselineColumn, mapping]),
      ),
    [config.mappings],
  );
  const suggestions = useMemo(
    () =>
      new Map(
        suggestColumnMappings(baseline.headers, comparison.headers).map(
          (suggestion) => [suggestion.baselineColumn, suggestion],
        ),
      ),
    [baseline.headers, comparison.headers],
  );
  const comparisonUseCount = useMemo(() => {
    const counts = new Map<string, number>();
    config.mappings.forEach((mapping) => {
      counts.set(
        mapping.comparisonColumn,
        (counts.get(mapping.comparisonColumn) ?? 0) + 1,
      );
    });
    return counts;
  }, [config.mappings]);
  const comparisonOwnersByColumn = useMemo(() => {
    const owners = new Map<string, string | null>();
    config.mappings.forEach((mapping) => {
      const currentOwner = owners.get(mapping.comparisonColumn);
      if (currentOwner === undefined) {
        owners.set(mapping.comparisonColumn, mapping.baselineColumn);
      } else if (currentOwner !== mapping.baselineColumn) {
        owners.set(mapping.comparisonColumn, null);
      }
    });
    return owners;
  }, [config.mappings]);
  const validMappings = useMemo(
    () =>
      config.mappings.filter(
        (mapping) =>
          baseline.headers.includes(mapping.baselineColumn) &&
          comparison.headers.includes(mapping.comparisonColumn) &&
          comparisonUseCount.get(mapping.comparisonColumn) === 1,
      ),
    [baseline.headers, comparison.headers, comparisonUseCount, config.mappings],
  );
  const validMappingIds = useMemo(
    () => new Set(validMappings.map((mapping) => mapping.id)),
    [validMappings],
  );
  const validKeyIds = uniqueIds(config.keyMappingIds).filter((id) =>
    validMappingIds.has(id),
  );
  const validCompareIds = uniqueIds(config.compareMappingIds).filter((id) =>
    validMappingIds.has(id),
  );
  const setMapping = (baselineColumn: string, comparisonColumn: string) => {
    const stableId = getMappingIdForBaselineColumn(
      baseline.headers,
      baselineColumn,
    );
    const previous = mappingByBaseline.get(baselineColumn);
    const relatedIds = new Set(
      [stableId, previous?.id].filter((id): id is string => Boolean(id)),
    );

    if (!comparisonColumn) {
      onConfigChange({
        ...config,
        mappings: config.mappings.filter(
          (mapping) => mapping.baselineColumn !== baselineColumn,
        ),
        keyMappingIds: withoutIds(config.keyMappingIds, relatedIds),
        compareMappingIds: withoutIds(config.compareMappingIds, relatedIds),
        normalizationByMappingId: cleanOverrides(
          config.normalizationByMappingId,
          relatedIds,
        ),
      });
      return;
    }

    const nextMapping: ColumnMapping = {
      id: stableId,
      label: baselineColumn,
      baselineColumn,
      comparisonColumn,
    };
    const mappings = [
      ...config.mappings.filter(
        (mapping) => mapping.baselineColumn !== baselineColumn,
      ),
      nextMapping,
    ].sort(
      (left, right) =>
        baseline.headers.indexOf(left.baselineColumn) -
        baseline.headers.indexOf(right.baselineColumn),
    );
    const previousId = previous?.id;
    const keyMappingIds = previousId
      ? replaceId(config.keyMappingIds, previousId, stableId)
      : config.keyMappingIds;
    const compareMappingIds = previousId
      ? replaceId(config.compareMappingIds, previousId, stableId)
      : config.compareMappingIds;
    const overrides = { ...(config.normalizationByMappingId ?? {}) };
    if (previousId && previousId !== stableId && overrides[previousId] !== undefined) {
      overrides[stableId] = overrides[previousId];
      delete overrides[previousId];
    }
    onConfigChange({
      ...config,
      mappings,
      keyMappingIds,
      compareMappingIds,
      normalizationByMappingId:
        Object.keys(overrides).length > 0 ? overrides : undefined,
    });
  };

  const setMappingRole = (
    mapping: ColumnMapping,
    role: MappingRole,
    checked: boolean,
  ) => {
    const stableId = getMappingIdForBaselineColumn(
      baseline.headers,
      mapping.baselineColumn,
    );
    const stableConfig = rekeyMapping(config, mapping, stableId);
    if (role === "key") {
      onConfigChange({
        ...stableConfig,
        keyMappingIds: checked
          ? uniqueIds([...stableConfig.keyMappingIds, stableId])
          : stableConfig.keyMappingIds.filter((id) => id !== stableId),
        // A matching key identifies a record; it is not itself a comparison field.
        compareMappingIds: checked
          ? stableConfig.compareMappingIds.filter((id) => id !== stableId)
          : stableConfig.compareMappingIds,
      });
      return;
    }
    onConfigChange({
      ...stableConfig,
      compareMappingIds: checked
        ? uniqueIds([...stableConfig.compareMappingIds, stableId])
        : stableConfig.compareMappingIds.filter((id) => id !== stableId),
      keyMappingIds: checked
        ? stableConfig.keyMappingIds.filter((id) => id !== stableId)
        : stableConfig.keyMappingIds,
    });
  };

  const setMappingValueType = (
    mapping: ColumnMapping,
    valueType: NormalizationOptions["valueType"],
  ) => {
    const stableId = getMappingIdForBaselineColumn(
      baseline.headers,
      mapping.baselineColumn,
    );
    const stableConfig = rekeyMapping(config, mapping, stableId);
    onConfigChange({
      ...stableConfig,
      normalizationByMappingId: {
        ...(stableConfig.normalizationByMappingId ?? {}),
        [stableId]: {
          ...(stableConfig.normalizationByMappingId?.[stableId] ?? {}),
          valueType,
        },
      },
    });
  };

  const setNormalization = <Key extends keyof NormalizationOptions>(
    key: Key,
    value: NormalizationOptions[Key],
  ) => {
    onConfigChange({
      ...config,
      normalization: { ...config.normalization, [key]: value },
    });
  };

  const submitTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = templateName.trim();
    if (!name) return;
    onSaveTemplate(name);
    setTemplateName("");
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`${tabSetId}-${nextTab.id}-tab`)?.focus();
  };

  return (
    <section className="config-panel" aria-label="照合条件の設定">
      <header className="config-panel__header">
        <div className="config-panel__heading">
          <span className="config-panel__eyebrow">RECONCILIATION SETUP</span>
          <h2>照合条件</h2>
          <p>対応する列、照合Key、比較方法を確認してから実行します。</p>
        </div>
        <button
          type="button"
          className="config-panel__reset-button"
          onClick={onReset}
          disabled={isComparing}
        >
          <RotateCcw size={15} aria-hidden="true" />
          初期設定に戻す
        </button>
      </header>

      <div className="config-panel__tabs" role="tablist" aria-label="照合設定">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`${tabSetId}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tabSetId}-${tab.id}-panel`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`config-panel__tab${
              activeTab === tab.id ? " config-panel__tab--active" : ""
            }`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "mapping" && (
        <div
          id={`${tabSetId}-mapping-panel`}
          className="config-panel__tabpanel"
          role="tabpanel"
          aria-labelledby={`${tabSetId}-mapping-tab`}
        >
          <div className="config-panel__section-heading">
            <div>
              <h3>Column Mapping</h3>
              <p>候補は自動確定されません。「候補を適用」で明示的に選択してください。</p>
            </div>
            <div className="config-panel__count-strip" role="group" aria-label="Mapping設定件数">
              <span>Mapped <strong>{validMappings.length}</strong></span>
              <span>Key <strong>{validKeyIds.length}</strong></span>
              <span>Compare <strong>{validCompareIds.length}</strong></span>
            </div>
          </div>

          <div
            className="mapping-table__scroller"
            role="region"
            tabIndex={0}
            aria-label="列Mapping表（横スクロールできます）"
          >
            <table className="mapping-table">
              <caption>基準データの全列と比較データ列の対応</caption>
              <thead>
                <tr>
                  <th scope="col">基準データ列</th>
                  <th scope="col">比較データ列</th>
                  <th scope="col">候補</th>
                  <th scope="col">Key</th>
                  <th scope="col">Compare</th>
                  <th scope="col">比較形式</th>
                </tr>
              </thead>
              <tbody>
                {baseline.headers.map((baselineColumn) => {
                  const mapping = mappingByBaseline.get(baselineColumn);
                  const suggestion = suggestions.get(baselineColumn);
                  const mappingIsValid = Boolean(
                    mapping &&
                      comparison.headers.includes(mapping.comparisonColumn) &&
                      comparisonUseCount.get(mapping.comparisonColumn) === 1,
                  );
                  const suggestionInUse = Boolean(
                    suggestion &&
                      comparisonColumnUsedByOther(
                        comparisonOwnersByColumn,
                        suggestion.comparisonColumn,
                        baselineColumn,
                      ),
                  );
                  const valueType = mapping
                    ? config.normalizationByMappingId?.[mapping.id]?.valueType ??
                      config.normalization.valueType
                    : config.normalization.valueType;
                  return (
                    <tr
                      key={baselineColumn}
                      className={`mapping-table__row${
                        mapping && !mappingIsValid ? " mapping-table__row--invalid" : ""
                      }`}
                    >
                      <th scope="row">
                        <span className="mapping-table__column-name">{baselineColumn}</span>
                        {isLikelyKeyColumn(baselineColumn) && (
                          <span className="mapping-table__key-candidate">
                            <KeyRound size={12} aria-hidden="true" />
                            Key候補
                          </span>
                        )}
                      </th>
                      <td>
                        <select
                          className="mapping-table__select"
                          value={
                            mapping && comparison.headers.includes(mapping.comparisonColumn)
                              ? mapping.comparisonColumn
                              : ""
                          }
                          aria-label={`${baselineColumn}の比較データ列`}
                          aria-invalid={mapping && !mappingIsValid ? true : undefined}
                          onChange={(event) =>
                            setMapping(baselineColumn, event.currentTarget.value)
                          }
                          disabled={isComparing}
                        >
                          <option value="">Mappingしない</option>
                          {comparison.headers.map((comparisonColumn) => {
                            const usedElsewhere = comparisonColumnUsedByOther(
                              comparisonOwnersByColumn,
                              comparisonColumn,
                              baselineColumn,
                            );
                            return (
                              <option
                                key={comparisonColumn}
                                value={comparisonColumn}
                                disabled={usedElsewhere}
                              >
                                {comparisonColumn}
                                {usedElsewhere ? "（使用済み）" : ""}
                              </option>
                            );
                          })}
                        </select>
                        {mapping && !mappingIsValid && (
                          <span className="mapping-table__validation" role="alert">
                            比較列の重複または欠落を解消してください。
                          </span>
                        )}
                      </td>
                      <td>
                        {!mapping && suggestion ? (
                          <div className="mapping-table__suggestion">
                            <span title={suggestion.comparisonColumn}>
                              <Sparkles size={13} aria-hidden="true" />
                              {suggestion.comparisonColumn}
                            </span>
                            <small>
                              {SUGGESTION_REASON[suggestion.reason]} · {Math.round(suggestion.score * 100)}%
                            </small>
                            <button
                              type="button"
                              onClick={() =>
                                setMapping(
                                  baselineColumn,
                                  suggestion.comparisonColumn,
                                )
                              }
                              disabled={isComparing || suggestionInUse}
                              aria-label={`${baselineColumn}に候補の${suggestion.comparisonColumn}を適用`}
                            >
                              候補を適用
                            </button>
                          </div>
                        ) : (
                          <span className="mapping-table__suggestion-empty">—</span>
                        )}
                      </td>
                      <td>
                        <label className="mapping-table__check">
                          <input
                            type="checkbox"
                            aria-label={`${baselineColumn}を照合Keyにする`}
                            checked={Boolean(
                              mapping && config.keyMappingIds.includes(mapping.id),
                            )}
                            disabled={!mappingIsValid || isComparing}
                            onChange={(event) =>
                              mapping &&
                              setMappingRole(mapping, "key", event.currentTarget.checked)
                            }
                          />
                          <span className="mapping-table__check-label">Key</span>
                        </label>
                      </td>
                      <td>
                        <label className="mapping-table__check">
                          <input
                            type="checkbox"
                            aria-label={`${baselineColumn}を比較対象にする`}
                            checked={Boolean(
                              mapping && config.compareMappingIds.includes(mapping.id),
                            )}
                            disabled={!mappingIsValid || isComparing}
                            onChange={(event) =>
                              mapping &&
                              setMappingRole(
                                mapping,
                                "compare",
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span className="mapping-table__check-label">Compare</span>
                        </label>
                      </td>
                      <td>
                        <select
                          className="mapping-table__type-select"
                          value={valueType}
                          aria-label={`${baselineColumn}の比較形式`}
                          disabled={!mappingIsValid || isComparing}
                          onChange={(event) =>
                            mapping &&
                            setMappingValueType(
                              mapping,
                              event.currentTarget.value as NormalizationOptions["valueType"],
                            )
                          }
                        >
                          {Object.entries(VALUE_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "normalization" && (
        <div
          id={`${tabSetId}-normalization-panel`}
          className="config-panel__tabpanel normalization-panel"
          role="tabpanel"
          aria-labelledby={`${tabSetId}-normalization-tab`}
        >
          <div className="config-panel__section-heading">
            <div>
              <h3>Normalization</h3>
              <p>原データは変更せず、照合時の比較値にだけ適用します。</p>
            </div>
            <SlidersHorizontal size={20} aria-hidden="true" />
          </div>

          <fieldset className="normalization-panel__checks">
            <legend>文字と空欄</legend>
            <label className="normalization-panel__option">
              <input
                type="checkbox"
                aria-label="前後の空白を除去"
                checked={config.normalization.trim}
                disabled={isComparing}
                onChange={(event) =>
                  setNormalization("trim", event.currentTarget.checked)
                }
              />
              <span><strong>前後の空白を除去</strong><small>`ABC ` と `ABC`を同一扱い</small></span>
            </label>
            <label className="normalization-panel__option">
              <input
                type="checkbox"
                aria-label="大文字・小文字を区別しない"
                checked={config.normalization.caseInsensitive}
                disabled={isComparing}
                onChange={(event) =>
                  setNormalization("caseInsensitive", event.currentTarget.checked)
                }
              />
              <span><strong>大文字・小文字を区別しない</strong><small>`TOKYO` と `tokyo`を同一扱い</small></span>
            </label>
            <label className="normalization-panel__option">
              <input
                type="checkbox"
                aria-label="空文字とnullを同一扱い"
                checked={config.normalization.emptyAsNull}
                disabled={isComparing}
                onChange={(event) =>
                  setNormalization("emptyAsNull", event.currentTarget.checked)
                }
              />
              <span><strong>空文字とnullを同一扱い</strong><small>空欄表現の違いを差分から除外</small></span>
            </label>
          </fieldset>

          <fieldset className="normalization-panel__radio-group">
            <legend>全角・半角</legend>
            {(
              [
                ["none", "変換しない"],
                ["half", "半角へ統一"],
                ["full", "全角へ統一"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="normalization-panel__radio">
                <input
                  type="radio"
                  name={`${tabSetId}-width`}
                  value={value}
                  checked={config.normalization.width === value}
                  disabled={isComparing}
                  onChange={() => setNormalization("width", value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="normalization-panel__radio-group">
            <legend>改行</legend>
            {(
              [
                ["preserve", "元の改行を保持"],
                ["lf", "LFへ統一"],
                ["space", "空白へ置換"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="normalization-panel__radio">
                <input
                  type="radio"
                  name={`${tabSetId}-line-breaks`}
                  value={value}
                  checked={config.normalization.lineBreaks === value}
                  disabled={isComparing}
                  onChange={() => setNormalization("lineBreaks", value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}

      {activeTab === "templates" && (
        <div
          id={`${tabSetId}-templates-panel`}
          className="config-panel__tabpanel template-panel"
          role="tabpanel"
          aria-labelledby={`${tabSetId}-templates-tab`}
        >
          <div className="config-panel__section-heading">
            <div>
              <h3>Compare Templates</h3>
              <p>Mapping、Key、比較列、Normalizationだけを次回の照合へ再利用します。</p>
            </div>
            <Save size={20} aria-hidden="true" />
          </div>

          <p className="template-panel__privacy">
            ファイル本体・行データ・セル値はテンプレートへ保存されません。
          </p>

          <form className="template-panel__save-form" onSubmit={submitTemplate}>
            <label htmlFor={`${tabSetId}-template-name`}>テンプレート名</label>
            <div className="template-panel__save-row">
              <input
                id={`${tabSetId}-template-name`}
                value={templateName}
                onChange={(event) => setTemplateName(event.currentTarget.value)}
                placeholder="例：月次顧客マスタ比較"
                maxLength={80}
                disabled={isComparing}
              />
              <button
                type="submit"
                disabled={isComparing || templateName.trim().length === 0}
              >
                <Save size={15} aria-hidden="true" />
                現在の設定を保存
              </button>
            </div>
          </form>

          {templates.length > 0 ? (
            <ul className="template-panel__list" aria-label="保存済みテンプレート">
              {templates.map((template) => {
                const compatible = isTemplateCompatible(
                  template,
                  baseline,
                  comparison,
                );
                return (
                  <li key={template.id} className="template-panel__item">
                    <div className="template-panel__item-copy">
                      <strong>{template.name}</strong>
                      <span>
                        Mapping {template.config.mappings.length}件 · 更新 {templateDate(template.updatedAt)}
                      </span>
                      {!compatible && (
                        <small role="status">現在の列構成とは一致しません</small>
                      )}
                    </div>
                    <div className="template-panel__item-actions">
                      <button
                        type="button"
                        onClick={() => onApplyTemplate(template.id)}
                        disabled={isComparing || !compatible}
                      >
                        <Check size={15} aria-hidden="true" />
                        適用
                      </button>
                      <button
                        type="button"
                        className="template-panel__delete-button"
                        onClick={() => onDeleteTemplate(template.id)}
                        disabled={isComparing}
                        aria-label={`${template.name}を削除`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="template-panel__empty" role="status">
              <strong>保存済みテンプレートはありません</strong>
              <span>現在の設定を保存すると、次回は選んで比較できます。</span>
            </div>
          )}
        </div>
      )}

      <footer className="config-panel__footer">
        <div className="config-panel__summary" role="group" aria-label="現在の照合設定">
          <span><strong>{validMappings.length}</strong> Mapping</span>
          <span><strong>{validKeyIds.length}</strong> Key</span>
          <span><strong>{validCompareIds.length}</strong> Compare</span>
        </div>
        <div className="config-panel__compare-area">
          <p id={compareHintId} className="config-panel__compare-hint" aria-live="polite">
            {!canCompare
              ? "有効なKeyと比較列をそれぞれ1つ以上設定してください。"
              : isStale
                ? "設定が変わりました。再比較すると結果を更新できます。"
                : "照合条件を確認済みです。"}
          </p>
          <button
            type="button"
            className="config-panel__compare-button"
            onClick={onCompare}
            disabled={!canCompare || isComparing}
            aria-describedby={compareHintId}
          >
            <GitCompareArrows size={17} aria-hidden="true" />
            {isComparing
              ? "照合しています…"
              : isStale
                ? "この設定で再比較"
                : "比較を実行"}
          </button>
        </div>
      </footer>
    </section>
  );
}
