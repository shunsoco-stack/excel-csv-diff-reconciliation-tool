"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileDown,
  LoaderCircle,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import {
  selectReconciliationItems,
  type ColumnMapping,
  type DuplicateGroup,
  type ReconciliationConfig,
  type ReconciliationListItem,
  type ReconciliationResult,
  type ReconciliationSort,
  type ResultFilterStatus,
  type RowIssue,
  type RowPointer,
} from "@/lib/reconciliation";
import {
  ROW_ID_KEY,
  type CellValue,
  type DataRow,
  type DataSet,
} from "@/lib/types";

const PAGE_SIZE = 25;

const STATUS_DEFINITIONS: ReadonlyArray<{
  status: ResultFilterStatus;
  label: string;
}> = [
  { status: "added", label: "追加" },
  { status: "removed", label: "削除" },
  { status: "changed", label: "変更" },
  { status: "unchanged", label: "一致" },
  { status: "duplicate", label: "重複" },
  { status: "error", label: "エラー" },
];

const STATUS_LABELS: Readonly<Record<ResultFilterStatus, string>> = {
  added: "追加",
  removed: "削除",
  changed: "変更",
  unchanged: "一致",
  duplicate: "重複",
  error: "エラー",
};

const STAGE_LABELS: Readonly<Record<string, string>> = {
  reading: "ファイルを読み込んでいます",
  parsing: "列と行を解析しています",
  normalizing: "比較値を正規化しています",
  matching: "照合Keyを照合しています",
  comparing: "セル単位の差分を計算しています",
  report: "結果レポートを準備しています",
};

export interface ResultsPanelProps {
  result: ReconciliationResult | null;
  resultRevision: number;
  baseline: DataSet;
  comparison: DataSet;
  config: ReconciliationConfig;
  isRunning: boolean;
  isStale: boolean;
  stage?: string | null;
  statuses: ResultFilterStatus[];
  onStatusesChange: (statuses: ResultFilterStatus[]) => void;
  changedMappingIds: string[];
  onChangedMappingIdsChange: (mappingIds: string[]) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sort: ReconciliationSort;
  onSortChange: (sort: ReconciliationSort) => void;
  onExportXlsx: () => void;
  onExportCsv: (items: readonly ReconciliationListItem[]) => void;
  onCopy: (items: readonly ReconciliationListItem[]) => void;
  exportBusy?: boolean;
}

function formatCount(value: number): string {
  return value.toLocaleString("ja-JP");
}

function formatRate(value: number): string {
  return `${(value * 100).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function displayValue(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "照合を実行しています";
  return STAGE_LABELS[stage] ?? stage;
}

function resolveRow(dataSet: DataSet, rowPointer: RowPointer | undefined): DataRow | null {
  if (!rowPointer) return null;
  const indexed = dataSet.rows[rowPointer.rowIndex];
  if (indexed?.[ROW_ID_KEY] === rowPointer.rowId) return indexed;
  return dataSet.rows.find((row) => row[ROW_ID_KEY] === rowPointer.rowId) ?? null;
}

function statusCounts(result: ReconciliationResult): Record<ResultFilterStatus, number> {
  return {
    added: result.summary.added,
    removed: result.summary.removed,
    changed: result.summary.changed,
    unchanged: result.summary.unchanged,
    duplicate: result.summary.duplicateKeys,
    error: result.errors.length,
  };
}

function itemKey(item: ReconciliationListItem): string {
  if (item.kind === "record") return `record:${item.status}:${item.value.keyToken}`;
  if (item.kind === "duplicate") return `duplicate:${item.value.keyToken}`;
  return `error:${item.value.side}:${item.value.row.rowId}:${item.value.reason}`;
}

function StatusIcon({ status }: { status: ResultFilterStatus }) {
  const common = { size: 16, strokeWidth: 2, "aria-hidden": true as const };
  switch (status) {
    case "added":
      return <PlusCircle {...common} />;
    case "removed":
      return <MinusCircle {...common} />;
    case "changed":
      return <RefreshCw {...common} />;
    case "unchanged":
      return <CheckCircle2 {...common} />;
    case "duplicate":
      return <ShieldAlert {...common} />;
    case "error":
      return <AlertCircle {...common} />;
  }
}

function StatusBadge({ status }: { status: ResultFilterStatus }) {
  return (
    <span className={`result-table__status result-table__status--${status}`}>
      <StatusIcon status={status} />
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
}

function SourceSnapshot({
  side,
  dataSet,
  rowPointer,
  mappings,
}: {
  side: "baseline" | "comparison";
  dataSet: DataSet;
  rowPointer: RowPointer | undefined;
  mappings: readonly ColumnMapping[];
}) {
  const row = resolveRow(dataSet, rowPointer);
  const sideLabel = side === "baseline" ? "基準データ" : "比較データ";
  if (!row || !rowPointer) {
    return (
      <div className="result-table__unresolved" role="status">
        元の行を参照できません。条件を確認して再照合してください。
      </div>
    );
  }

  return (
    <div className="result-table__snapshot">
      <p className="result-table__source-label">
        {sideLabel} · {dataSet.name} · {formatCount(rowPointer.rowIndex + 1)}行目
      </p>
      <dl className="result-table__snapshot-grid">
        {mappings.map((mapping) => {
          const column = side === "baseline"
            ? mapping.baselineColumn
            : mapping.comparisonColumn;
          return (
            <div className="result-table__snapshot-item" key={mapping.id}>
              <dt>{mapping.label}</dt>
              <dd title={displayValue(row[column])}>{displayValue(row[column])}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function ChangedDetails({ item }: {
  item: Extract<ReconciliationListItem, { kind: "record" }>;
}) {
  return (
    <ul className="result-table__diff-list" aria-label="セル単位の変更内容">
      {item.value.changes.map((change) => (
        <li className="result-table__diff-item" key={change.mappingId}>
          <strong className="result-table__diff-column">{change.label}</strong>
          <span className="result-table__diff-value result-table__diff-value--before">
            <span className="result-table__diff-label">Before</span>
            <span title={displayValue(change.before)}>{displayValue(change.before)}</span>
          </span>
          <span className="result-table__diff-arrow" aria-hidden="true">→</span>
          <span className="result-table__diff-value result-table__diff-value--after">
            <span className="result-table__diff-label">After</span>
            <span title={displayValue(change.after)}>{displayValue(change.after)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DuplicateDetails({ group }: { group: DuplicateGroup }) {
  const duplicateSide = group.duplicateSides
    .map((side) => side === "baseline" ? "基準" : "比較")
    .join("・");
  return (
    <div className="result-table__duplicate-detail">
      <strong>重複側: {duplicateSide}</strong>
      <span>
        基準 {formatCount(group.baselineRows.length)}行 / 比較 {formatCount(group.comparisonRows.length)}行
      </span>
      <small>同じKeyの行は自動選択せず、すべて照合対象外として保持しています。</small>
    </div>
  );
}

function ErrorDetails({
  issue,
  config,
  baseline,
  comparison,
}: {
  issue: RowIssue;
  config: ReconciliationConfig;
  baseline: DataSet;
  comparison: DataSet;
}) {
  const dataSet = issue.side === "baseline" ? baseline : comparison;
  const sideLabel = issue.side === "baseline" ? "基準データ" : "比較データ";
  const labelsById = new Map(config.mappings.map((mapping) => [mapping.id, mapping.label]));
  const affected = issue.mappingIds.map((id) => labelsById.get(id) ?? id).join("、");
  const sourceAvailable = Boolean(resolveRow(dataSet, issue.row));
  return (
    <div className="result-table__error-detail">
      <strong>{sideLabel} · {dataSet.name} · {formatCount(issue.row.rowIndex + 1)}行目</strong>
      <span>{issue.message}</span>
      <small>対象列: {affected || "不明"}</small>
      {!sourceAvailable && (
        <small className="result-table__unresolved">元の行を参照できません。再照合してください。</small>
      )}
    </div>
  );
}

function ResultDetail({
  item,
  baseline,
  comparison,
  config,
}: {
  item: ReconciliationListItem;
  baseline: DataSet;
  comparison: DataSet;
  config: ReconciliationConfig;
}) {
  if (item.kind === "duplicate") return <DuplicateDetails group={item.value} />;
  if (item.kind === "error") {
    return (
      <ErrorDetails
        issue={item.value}
        config={config}
        baseline={baseline}
        comparison={comparison}
      />
    );
  }
  if (item.status === "changed") return <ChangedDetails item={item} />;
  if (item.status === "added") {
    return (
      <SourceSnapshot
        side="comparison"
        dataSet={comparison}
        rowPointer={item.value.comparison}
        mappings={config.mappings}
      />
    );
  }
  if (item.status === "removed") {
    return (
      <SourceSnapshot
        side="baseline"
        dataSet={baseline}
        rowPointer={item.value.baseline}
        mappings={config.mappings}
      />
    );
  }
  return (
    <p className="result-table__unchanged-detail">
      Keyと選択した比較対象列はすべて一致しています。
    </p>
  );
}

function changeCount(item: ReconciliationListItem): string {
  if (item.kind === "record" && item.status === "changed") {
    return `${formatCount(item.value.changes.length)}項目`;
  }
  if (item.kind === "duplicate") return `${formatCount(item.value.baselineRows.length + item.value.comparisonRows.length)}行`;
  if (item.kind === "error") return "要確認";
  return "—";
}

export function ResultsPanel({
  result,
  resultRevision,
  baseline,
  comparison,
  config,
  isRunning,
  isStale,
  stage = null,
  statuses,
  onStatusesChange,
  changedMappingIds,
  onChangedMappingIdsChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
  onExportXlsx,
  onExportCsv,
  onCopy,
  exportBusy = false,
}: ResultsPanelProps) {
  const headingId = useId();
  const searchId = useId();
  const changedColumnId = useId();
  const sortId = useId();
  const deferredSearch = useDeferredValue(search);
  const statusKey = statuses.join("|");
  const changedKey = changedMappingIds.join("|");
  const filterKey = `${statusKey}::${changedKey}::${deferredSearch}::${sort}`;
  const [pagination, setPagination] = useState<{
    resultRevision: number;
    filterKey: string;
    page: number;
  }>({ resultRevision, filterKey, page: 1 });

  const changedColumns = useMemo(() => {
    const mappingsById = new Map(config.mappings.map((mapping) => [mapping.id, mapping]));
    return config.compareMappingIds.flatMap((id) => {
      const mapping = mappingsById.get(id);
      return mapping ? [mapping] : [];
    });
  }, [config.compareMappingIds, config.mappings]);
  const availableChangedIds = useMemo(
    () => new Set(changedColumns.map((mapping) => mapping.id)),
    [changedColumns],
  );
  const safeChangedMappingIds = useMemo(
    () => changedMappingIds.filter((id) => availableChangedIds.has(id)),
    [availableChangedIds, changedMappingIds],
  );

  const filteredItems = useMemo(
    () => result
      ? selectReconciliationItems(result, baseline, comparison, {
          statuses,
          changedMappingIds: safeChangedMappingIds,
          search: deferredSearch,
          sort,
        })
      : [],
    [
      baseline,
      comparison,
      deferredSearch,
      result,
      safeChangedMappingIds,
      sort,
      statuses,
    ],
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = pagination.resultRevision === resultRevision && pagination.filterKey === filterKey
    ? pagination.page
    : 1;
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageItems = filteredItems.slice(startIndex, startIndex + PAGE_SIZE);
  const allResultItemCount = result
    ? result.records.length + result.duplicates.length + result.errors.length
    : 0;
  const counts = result ? statusCounts(result) : null;
  const controlsDisabled = !result || isRunning;
  const exportDisabled = !result || isRunning || isStale || exportBusy;

  const toggleStatus = (status: ResultFilterStatus) => {
    const selected = new Set(statuses);
    if (selected.has(status)) selected.delete(status);
    else selected.add(status);
    onStatusesChange(
      STATUS_DEFINITIONS
        .map((definition) => definition.status)
        .filter((candidate) => selected.has(candidate)),
    );
  };

  const clearFilters = () => {
    onStatusesChange(STATUS_DEFINITIONS.map((definition) => definition.status));
    onChangedMappingIdsChange([]);
    onSearchChange("");
  };

  const summaryCards = result ? [
    { key: "total", label: "照合対象", value: formatCount(result.summary.totalRecords) },
    { key: "added", label: "追加", value: formatCount(result.summary.added) },
    { key: "removed", label: "削除", value: formatCount(result.summary.removed) },
    { key: "changed", label: "変更", value: formatCount(result.summary.changed) },
    { key: "unchanged", label: "一致", value: formatCount(result.summary.unchanged) },
    { key: "duplicate", label: "重複Key", value: formatCount(result.summary.duplicateKeys) },
    { key: "error", label: "要確認行", value: formatCount(result.summary.errorRows) },
    { key: "difference-rate", label: "差異率", value: formatRate(result.summary.differenceRate) },
    { key: "match-rate", label: "一致率", value: formatRate(result.summary.matchRate) },
  ] : [];

  return (
    <section
      id="results"
      className="results-panel"
      aria-labelledby={headingId}
      aria-busy={isRunning || exportBusy || search !== deferredSearch || undefined}
    >
      <header className="results-panel__header">
        <div className="results-panel__heading-group">
          <span className="results-panel__eyebrow">RECONCILIATION RESULT</span>
          <h2 id={headingId}>照合結果</h2>
          <p>RecordとCellの差分を、原データを変更せずに表示します。</p>
        </div>
        <div className="results-panel__actions" role="group" aria-label="照合結果の出力">
          <button type="button" onClick={onExportXlsx} disabled={exportDisabled}>
            {exportBusy ? <LoaderCircle size={16} aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
            XLSXレポート
          </button>
          <button
            type="button"
            onClick={() => onExportCsv(filteredItems)}
            disabled={exportDisabled}
          >
            <Download size={16} aria-hidden="true" />
            CSV出力
          </button>
          <button
            type="button"
            onClick={() => onCopy(filteredItems)}
            disabled={exportDisabled || filteredItems.length === 0}
          >
            <ClipboardCopy size={16} aria-hidden="true" />
            表示結果をコピー
          </button>
        </div>
      </header>

      {isRunning && (
        <div className="results-panel__progress" role="status" aria-live="polite">
          <LoaderCircle className="results-panel__progress-icon" size={18} aria-hidden="true" />
          <div>
            <strong>{stageLabel(stage)}</strong>
            <span>実際の処理段階を表示しています。完了まで結果を更新しません。</span>
          </div>
        </div>
      )}

      {!result && !isRunning && (
        <div className="results-panel__empty" role="status">
          <strong>まだ照合結果はありません</strong>
          <span>2つのファイル、Column Mapping、照合Keyを設定して比較を実行してください。</span>
        </div>
      )}

      {!result && isRunning && (
        <div className="results-panel__loading" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      {result && (
        <>
          <dl className="summary-dashboard" aria-label="照合結果サマリー">
            {summaryCards.map((card) => (
              <div className={`summary-card summary-card--${card.key}`} key={card.key}>
                <dt>{card.label}</dt>
                <dd>{card.value}</dd>
              </div>
            ))}
          </dl>

          <p className="results-panel__announcement" role="status" aria-live="polite">
            {formatCount(result.summary.totalRecords)}件を照合し、追加{formatCount(result.summary.added)}件、
            削除{formatCount(result.summary.removed)}件、変更{formatCount(result.summary.changed)}件、
            一致{formatCount(result.summary.unchanged)}件を検出しました。
          </p>

          <div className="results-panel__filters">
            <fieldset className="results-panel__status-filters" disabled={controlsDisabled}>
              <legend>判定で絞り込む</legend>
              <div className="results-panel__status-chips">
                {STATUS_DEFINITIONS.map(({ status, label }) => {
                  const selected = statuses.includes(status);
                  return (
                    <button
                      type="button"
                      className={`results-panel__status-chip results-panel__status-chip--${status}${selected ? " results-panel__status-chip--selected" : ""}`}
                      aria-pressed={selected}
                      aria-label={`${label} ${formatCount(counts?.[status] ?? 0)}件を${selected ? "非表示にする" : "表示する"}`}
                      onClick={() => toggleStatus(status)}
                      key={status}
                    >
                      <StatusIcon status={status} />
                      <span>{label}</span>
                      <strong>{formatCount(counts?.[status] ?? 0)}</strong>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="results-panel__filter-grid">
              <label className="results-panel__search-field" htmlFor={searchId}>
                <span>Key・名称を検索</span>
                <span className="results-panel__input-wrap">
                  <Search size={16} aria-hidden="true" />
                  <input
                    id={searchId}
                    type="search"
                    value={search}
                    placeholder="顧客ID、商品名など"
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    disabled={controlsDisabled}
                  />
                </span>
              </label>

              <div className="results-panel__select-field">
                <label htmlFor={changedColumnId}>変更列で絞り込む</label>
                <select
                  id={changedColumnId}
                  multiple
                  value={safeChangedMappingIds}
                  onChange={(event) => onChangedMappingIdsChange(
                    Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                  )}
                  disabled={controlsDisabled || changedColumns.length === 0}
                  aria-describedby={`${changedColumnId}-hint`}
                >
                  {changedColumns.map((mapping) => (
                    <option value={mapping.id} key={mapping.id}>{mapping.label}</option>
                  ))}
                </select>
                <small id={`${changedColumnId}-hint`}>複数選択できます。未選択時はすべての列を表示します。</small>
                {safeChangedMappingIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChangedMappingIdsChange([])}
                    disabled={controlsDisabled}
                  >
                    変更列の選択を解除
                  </button>
                )}
              </div>

              <label className="results-panel__select-field" htmlFor={sortId}>
                <span>並び順</span>
                <select
                  id={sortId}
                  value={sort}
                  onChange={(event) => onSortChange(event.currentTarget.value as ReconciliationSort)}
                  disabled={controlsDisabled}
                >
                  <option value="source">元データ順</option>
                  <option value="key-asc">Key 昇順</option>
                  <option value="key-desc">Key 降順</option>
                  <option value="changes-desc">変更列数 多い順</option>
                  <option value="changes-asc">変更列数 少ない順</option>
                </select>
              </label>
            </div>
          </div>

          {allResultItemCount === 0 ? (
            <div className="results-panel__empty results-panel__empty--result" role="status">
              <CheckCircle2 size={22} aria-hidden="true" />
              <strong>照合対象のRecordがありません</strong>
              <span>選択したSheetにデータ行があるか確認してください。</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="results-panel__empty results-panel__empty--filtered" role="status">
              <Search size={22} aria-hidden="true" />
              <strong>条件に一致する結果がありません</strong>
              <span>判定、変更列、検索語のいずれかを変更してください。</span>
              <button type="button" onClick={clearFilters}>絞り込みを解除</button>
            </div>
          ) : (
            <>
              <div
                className="result-table__scroller"
                role="region"
                tabIndex={0}
                aria-label="照合結果テーブル。横方向にスクロールできます"
              >
                <table className="result-table">
                  <caption>
                    絞り込み結果 {formatCount(filteredItems.length)}件のうち、
                    {formatCount(startIndex + 1)}〜{formatCount(Math.min(startIndex + PAGE_SIZE, filteredItems.length))}件
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">判定</th>
                      <th scope="col">照合Key</th>
                      <th scope="col">内容</th>
                      <th scope="col">差分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => (
                      <tr className={`result-table__row result-table__row--${item.status}`} key={itemKey(item)}>
                        <th scope="row" data-label="判定">
                          <StatusBadge status={item.status} />
                        </th>
                        <td className="result-table__key" data-label="照合Key">
                          <strong title={item.value.keyDisplay}>{item.value.keyDisplay}</strong>
                        </td>
                        <td className="result-table__detail" data-label="内容">
                          <ResultDetail
                            item={item}
                            baseline={baseline}
                            comparison={comparison}
                            config={config}
                          />
                        </td>
                        <td className="result-table__count" data-label="差分">
                          {changeCount(item)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <nav className="results-panel__pagination" aria-label="照合結果のページ">
                <p aria-live="polite">
                  {formatCount(safePage)} / {formatCount(totalPages)}ページ · 全{formatCount(filteredItems.length)}件
                </p>
                <div className="results-panel__pagination-buttons">
                  <button
                    type="button"
                    onClick={() => setPagination({
                      resultRevision,
                      filterKey,
                      page: Math.max(1, safePage - 1),
                    })}
                    disabled={safePage <= 1}
                    aria-label="前の25件"
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                    前へ
                  </button>
                  <button
                    type="button"
                    onClick={() => setPagination({
                      resultRevision,
                      filterKey,
                      page: Math.min(totalPages, safePage + 1),
                    })}
                    disabled={safePage >= totalPages}
                    aria-label="次の25件"
                  >
                    次へ
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            </>
          )}
        </>
      )}
    </section>
  );
}
