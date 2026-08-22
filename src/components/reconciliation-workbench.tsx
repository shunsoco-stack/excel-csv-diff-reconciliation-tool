"use client";

import Image from "next/image";
import {
  ArrowDown,
  ArrowLeftRight,
  Check,
  FileCheck2,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConfigurationPanel } from "./configuration-panel";
import {
  FileSourcePanel,
  type FileSourceSide,
} from "./file-source-panel";
import { ResultsPanel } from "./results-panel";
import {
  DEMO_SCENARIOS,
  getDemoScenario,
  type DemoScenarioId,
} from "@/lib/demo-data";
import {
  MAX_FILE_SIZE_BYTES,
  readDataFile,
  type ImportedTabularFile,
} from "@/lib/file-io";
import {
  createInitialConfig,
  getReconciliationConfigIssue,
} from "@/lib/mapping";
import {
  reconcileDataSets,
  type ReconciliationConfig,
  type ReconciliationListItem,
  type ReconciliationResult,
  type ReconciliationSort,
  type ResultFilterStatus,
} from "@/lib/reconciliation";
import {
  createTemplate,
  isTemplateCompatible,
  loadTemplates,
  persistTemplates,
  removeTemplate,
  upsertTemplate,
  type ReconciliationTemplate,
} from "@/lib/template-store";
import type { DataSet } from "@/lib/types";
import {
  createWorkerRequestId,
  ReconciliationWorkerClient,
} from "@/lib/worker-client";
import type {
  ProcessingStage,
  WorkerSuccess,
} from "@/lib/worker-protocol";

const INITIAL_DEMO = getDemoScenario("customers");
const ALL_STATUSES: ResultFilterStatus[] = [
  "added",
  "removed",
  "changed",
  "unchanged",
  "duplicate",
  "error",
];

type ParseWorkerSuccess = Extract<WorkerSuccess, { kind: "parse" }>;
type ReconcileWorkerSuccess = Extract<WorkerSuccess, { kind: "reconcile" }>;

function cloneConfig(config: ReconciliationConfig): ReconciliationConfig {
  return {
    ...config,
    mappings: config.mappings.map((mapping) => ({ ...mapping })),
    keyMappingIds: [...config.keyMappingIds],
    compareMappingIds: [...config.compareMappingIds],
    normalization: { ...config.normalization },
    normalizationByMappingId: config.normalizationByMappingId
      ? Object.fromEntries(
          Object.entries(config.normalizationByMappingId).map(([id, options]) => [
            id,
            { ...options },
          ]),
        )
      : undefined,
  };
}

function selectedDataSet(
  importedFile: ImportedTabularFile | null,
  sheetIndex: number,
): DataSet | null {
  if (!importedFile) return null;
  return importedFile.dataSets[sheetIndex] ?? importedFile.dataSet ?? null;
}

function stageLabel(stage: ProcessingStage | null): string {
  switch (stage) {
    case "reading":
      return "Reading · ファイルを読み込み中";
    case "parsing":
      return "Parsing · 列と行を解析中";
    case "reconciling":
      return "Normalizing → Matching → Comparing · ブラウザ内で照合中";
    case "report":
      return "Report · 集計結果を作成中";
    default:
      return "";
  }
}

function downloadBytes(bytes: Uint8Array, mimeType: string, fileName: string): void {
  const safeBytes = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([safeBytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function statusLabel(status: ResultFilterStatus): string {
  return {
    added: "追加",
    removed: "削除",
    changed: "変更",
    unchanged: "一致",
    duplicate: "重複",
    error: "照合不能",
  }[status];
}

export function ReconciliationWorkbench() {
  const [baselineFile, setBaselineFile] = useState<ImportedTabularFile | null>(
    INITIAL_DEMO.baseline,
  );
  const [comparisonFile, setComparisonFile] = useState<ImportedTabularFile | null>(
    INITIAL_DEMO.comparison,
  );
  const [baselineSheetIndex, setBaselineSheetIndex] = useState(0);
  const [comparisonSheetIndex, setComparisonSheetIndex] = useState(0);
  const [config, setConfig] = useState<ReconciliationConfig>(() =>
    cloneConfig(INITIAL_DEMO.config),
  );
  const [resultConfig, setResultConfig] = useState<ReconciliationConfig>(() =>
    cloneConfig(INITIAL_DEMO.config),
  );
  const [result, setResult] = useState<ReconciliationResult | null>(() =>
    reconcileDataSets(
      INITIAL_DEMO.baseline.dataSet,
      INITIAL_DEMO.comparison.dataSet,
      INITIAL_DEMO.config,
    ),
  );
  const [resultRevision, setResultRevision] = useState(0);
  const [activeDemoId, setActiveDemoId] = useState<DemoScenarioId | null>(
    INITIAL_DEMO.id,
  );
  const [templates, setTemplates] = useState<ReconciliationTemplate[]>([]);
  const [statuses, setStatuses] = useState<ResultFilterStatus[]>(ALL_STATUSES);
  const [changedMappingIds, setChangedMappingIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ReconciliationSort>("source");
  const [sourceBusy, setSourceBusy] = useState<Record<FileSourceSide, string | null>>({
    baseline: null,
    comparison: null,
  });
  const [sourceErrors, setSourceErrors] = useState<Record<FileSourceSide, string | null>>({
    baseline: null,
    comparison: null,
  });
  const [processingStage, setProcessingStage] = useState<ProcessingStage | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const workerRef = useRef<ReconciliationWorkerClient | null>(null);
  const baselineFileRef = useRef<ImportedTabularFile | null>(baselineFile);
  const comparisonFileRef = useRef<ImportedTabularFile | null>(comparisonFile);
  const baselineSheetIndexRef = useRef(baselineSheetIndex);
  const comparisonSheetIndexRef = useRef(comparisonSheetIndex);
  const sourceRequestVersionRef = useRef<Record<FileSourceSide, number>>({
    baseline: 0,
    comparison: 0,
  });
  const sourceActiveRef = useRef<Record<FileSourceSide, boolean>>({
    baseline: false,
    comparison: false,
  });
  const comparisonRequestVersionRef = useRef(0);
  const comparisonActiveRef = useRef(false);

  const baseline = selectedDataSet(baselineFile, baselineSheetIndex);
  const comparison = selectedDataSet(comparisonFile, comparisonSheetIndex);
  const hasSourceWork = Boolean(sourceBusy.baseline || sourceBusy.comparison);
  const configIssue = useMemo(
    () =>
      baseline && comparison
        ? getReconciliationConfigIssue(baseline, comparison, config)
        : "基準ファイルと比較ファイルを追加してください。",
    [baseline, comparison, config],
  );
  const canCompare = Boolean(baseline && comparison && !configIssue);
  const isInteractionLocked = isRunning || hasSourceWork || exportBusy;

  useEffect(() => {
    const sourceRequestVersions = sourceRequestVersionRef.current;
    if (typeof Worker !== "undefined") {
      workerRef.current = new ReconciliationWorkerClient();
    }
    setTemplates(loadTemplates(window.localStorage));
    return () => {
      sourceRequestVersions.baseline += 1;
      sourceRequestVersions.comparison += 1;
      comparisonRequestVersionRef.current += 1;
      sourceActiveRef.current = { baseline: false, comparison: false };
      comparisonActiveRef.current = false;
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const invalidateComparison = useCallback((reason: string) => {
    const hadPendingComparison = comparisonActiveRef.current;
    comparisonRequestVersionRef.current += 1;
    comparisonActiveRef.current = false;
    if (hadPendingComparison) workerRef.current?.restart(reason);
    setIsRunning(false);
    setProcessingStage(null);
  }, []);

  const invalidatePendingWork = useCallback((reason: string) => {
    const hadPendingWork = comparisonActiveRef.current
      || sourceActiveRef.current.baseline
      || sourceActiveRef.current.comparison;
    sourceRequestVersionRef.current.baseline += 1;
    sourceRequestVersionRef.current.comparison += 1;
    comparisonRequestVersionRef.current += 1;
    sourceActiveRef.current = { baseline: false, comparison: false };
    comparisonActiveRef.current = false;
    if (hadPendingWork) workerRef.current?.restart(reason);
    setSourceBusy({ baseline: null, comparison: null });
    setIsRunning(false);
    setProcessingStage(null);
  }, []);

  const markConfigurationChanged = useCallback((next: ReconciliationConfig) => {
    invalidateComparison("照合条件が変更されました。");
    setConfig(next);
    setChangedMappingIds([]);
    setIsStale(Boolean(result));
    setGlobalError(null);
  }, [invalidateComparison, result]);

  const runComparison = useCallback(async () => {
    if (!baseline || !comparison) {
      setGlobalError("基準ファイルと比較ファイルを追加してください。");
      return;
    }
    if (configIssue) {
      setGlobalError(configIssue);
      return;
    }
    if (sourceActiveRef.current.baseline || sourceActiveRef.current.comparison) {
      setGlobalError("ファイルの読み込み完了後に比較してください。");
      return;
    }
    if (comparisonActiveRef.current || exportBusy) return;

    const requestVersion = comparisonRequestVersionRef.current + 1;
    comparisonRequestVersionRef.current = requestVersion;
    workerRef.current?.restart("新しい照合を開始しました。");
    comparisonActiveRef.current = true;
    setGlobalError(null);
    setIsRunning(true);
    setProcessingStage("reconciling");
    try {
      let nextResult: ReconciliationResult;
      let nextDuration = 0;
      if (workerRef.current) {
        const response = await workerRef.current.request<ReconcileWorkerSuccess>(
          {
            id: createWorkerRequestId("reconcile"),
            kind: "reconcile",
            baseline,
            comparison,
            config,
          },
          [],
          (nextStage) => {
            if (comparisonRequestVersionRef.current === requestVersion) {
              setProcessingStage(nextStage);
            }
          },
        );
        nextResult = response.result;
        nextDuration = response.durationMs;
      } else {
        const startedAt = performance.now();
        nextResult = reconcileDataSets(baseline, comparison, config);
        nextDuration = performance.now() - startedAt;
        setProcessingStage("report");
      }
      if (comparisonRequestVersionRef.current !== requestVersion) return;
      setResult(nextResult);
      setResultRevision((current) => current + 1);
      setResultConfig(cloneConfig(config));
      setDurationMs(nextDuration);
      setIsStale(false);
      setToast("照合が完了しました。原本ファイルは変更されていません。");
    } catch (error) {
      if (comparisonRequestVersionRef.current === requestVersion) {
        setGlobalError(error instanceof Error ? error.message : "照合に失敗しました。");
      }
    } finally {
      if (comparisonRequestVersionRef.current === requestVersion) {
        comparisonActiveRef.current = false;
        setIsRunning(false);
        setProcessingStage(null);
      }
    }
  }, [baseline, comparison, config, configIssue, exportBusy]);

  const handleFile = useCallback(async (side: FileSourceSide, file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSourceErrors((current) => ({
        ...current,
        [side]: "ファイルサイズが25 MiBを超えています。",
      }));
      return;
    }
    if (comparisonActiveRef.current) {
      invalidateComparison("入力ファイルが変更されました。");
    }
    const requestVersion = sourceRequestVersionRef.current[side] + 1;
    sourceRequestVersionRef.current[side] = requestVersion;
    sourceActiveRef.current[side] = true;
    setSourceErrors((current) => ({ ...current, [side]: null }));
    setSourceBusy((current) => ({ ...current, [side]: "reading" }));
    setGlobalError(null);
    try {
      const buffer = await file.arrayBuffer();
      if (sourceRequestVersionRef.current[side] !== requestVersion) return;
      setSourceBusy((current) => ({ ...current, [side]: "parsing" }));
      let imported: ImportedTabularFile;
      if (workerRef.current) {
        const response = await workerRef.current.request<ParseWorkerSuccess>(
          {
            id: createWorkerRequestId("parse"),
            kind: "parse",
            buffer,
            file: { name: file.name, size: file.size, type: file.type },
          },
          [buffer],
          (stage) => {
            if (
              stage === "parsing" &&
              sourceRequestVersionRef.current[side] === requestVersion
            ) {
              setSourceBusy((current) => ({ ...current, [side]: "parsing" }));
            }
          },
        );
        imported = response.result;
      } else {
        imported = await readDataFile(buffer, file);
      }
      if (sourceRequestVersionRef.current[side] !== requestVersion) return;

      if (side === "baseline") {
        baselineFileRef.current = imported;
        baselineSheetIndexRef.current = 0;
        setBaselineFile(imported);
        setBaselineSheetIndex(0);
      } else {
        comparisonFileRef.current = imported;
        comparisonSheetIndexRef.current = 0;
        setComparisonFile(imported);
        setComparisonSheetIndex(0);
      }
      const nextBaseline = selectedDataSet(
        baselineFileRef.current,
        baselineSheetIndexRef.current,
      );
      const nextComparison = selectedDataSet(
        comparisonFileRef.current,
        comparisonSheetIndexRef.current,
      );
      if (nextBaseline && nextComparison) {
        setConfig(createInitialConfig(nextBaseline, nextComparison));
      }
      setResult(null);
      setIsStale(false);
      setActiveDemoId(null);
      setDurationMs(null);
      setToast(`${file.name} をブラウザ内で読み込みました。`);
    } catch (error) {
      if (sourceRequestVersionRef.current[side] === requestVersion) {
        setSourceErrors((current) => ({
          ...current,
          [side]: error instanceof Error ? error.message : "ファイルの解析に失敗しました。",
        }));
      }
    } finally {
      if (sourceRequestVersionRef.current[side] === requestVersion) {
        sourceActiveRef.current[side] = false;
        setSourceBusy((current) => ({ ...current, [side]: null }));
      }
    }
  }, [invalidateComparison]);

  const handleSheetChange = (side: FileSourceSide, sheetIndex: number) => {
    invalidatePendingWork("比較対象シートが変更されました。");
    if (side === "baseline") {
      baselineSheetIndexRef.current = sheetIndex;
      setBaselineSheetIndex(sheetIndex);
    } else {
      comparisonSheetIndexRef.current = sheetIndex;
      setComparisonSheetIndex(sheetIndex);
    }
    const nextBaseline = selectedDataSet(
      baselineFileRef.current,
      baselineSheetIndexRef.current,
    );
    const nextComparison = selectedDataSet(
      comparisonFileRef.current,
      comparisonSheetIndexRef.current,
    );
    if (nextBaseline && nextComparison) {
      setConfig(createInitialConfig(nextBaseline, nextComparison));
    }
    setResult(null);
    setIsStale(false);
    setActiveDemoId(null);
    setDurationMs(null);
  };

  const clearSource = (side: FileSourceSide) => {
    invalidatePendingWork("入力ファイルがクリアされました。");
    if (side === "baseline") {
      baselineFileRef.current = null;
      baselineSheetIndexRef.current = 0;
      setBaselineFile(null);
      setBaselineSheetIndex(0);
    } else {
      comparisonFileRef.current = null;
      comparisonSheetIndexRef.current = 0;
      setComparisonFile(null);
      setComparisonSheetIndex(0);
    }
    setSourceErrors((current) => ({ ...current, [side]: null }));
    setResult(null);
    setIsStale(false);
    setActiveDemoId(null);
    setDurationMs(null);
  };

  const loadDemo = (demoId: DemoScenarioId) => {
    invalidatePendingWork("デモデータが選択されました。");
    const demo = getDemoScenario(demoId);
    const nextConfig = cloneConfig(demo.config);
    baselineFileRef.current = demo.baseline;
    comparisonFileRef.current = demo.comparison;
    baselineSheetIndexRef.current = 0;
    comparisonSheetIndexRef.current = 0;
    setBaselineFile(demo.baseline);
    setComparisonFile(demo.comparison);
    setBaselineSheetIndex(0);
    setComparisonSheetIndex(0);
    setConfig(nextConfig);
    setResultConfig(cloneConfig(nextConfig));
    setResult(reconcileDataSets(demo.baseline.dataSet, demo.comparison.dataSet, nextConfig));
    setResultRevision((current) => current + 1);
    setActiveDemoId(demo.id);
    setStatuses([...ALL_STATUSES]);
    setChangedMappingIds([]);
    setSearch("");
    setSort("source");
    setSourceErrors({ baseline: null, comparison: null });
    setGlobalError(null);
    setIsStale(false);
    setDurationMs(null);
    setToast(`${demo.shortLabel}デモを読み込みました。`);
  };

  const saveTemplate = (name: string) => {
    if (!baseline || !comparison) return;
    try {
      const template = createTemplate(
        name,
        baseline,
        comparison,
        config,
        statuses,
      );
      const next = upsertTemplate(templates, template);
      persistTemplates(window.localStorage, next);
      setTemplates(next);
      setToast(`「${template.name}」を設定のみ保存しました。`);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "テンプレートを保存できませんでした。");
    }
  };

  const applyTemplate = (templateId: string) => {
    if (!baseline || !comparison) return;
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    if (!isTemplateCompatible(template, baseline, comparison)) {
      setGlobalError("このテンプレートの列が現在のファイルにありません。Column Mappingを確認してください。");
      return;
    }
    markConfigurationChanged(cloneConfig(template.config));
    setStatuses([...template.resultFilter]);
    setToast(`「${template.name}」を適用しました。`);
  };

  const deleteTemplate = (templateId: string) => {
    try {
      const next = removeTemplate(templates, templateId);
      persistTemplates(window.localStorage, next);
      setTemplates(next);
      setToast("テンプレートを削除しました。");
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "テンプレートを削除できませんでした。",
      );
    }
  };

  const resetConfiguration = () => {
    if (!baseline || !comparison) return;
    const demo = activeDemoId ? getDemoScenario(activeDemoId) : null;
    const next = demo
      ? cloneConfig(demo.config)
      : createInitialConfig(baseline, comparison);
    markConfigurationChanged(next);
    setToast("照合条件を初期状態へ戻しました。");
  };

  const exportXlsx = async () => {
    if (!result || !baseline || !comparison) return;
    if (isStale) {
      setGlobalError("条件変更後に再比較してからExportしてください。");
      return;
    }
    setExportBusy(true);
    try {
      const { createReconciliationXlsxReport, RECONCILIATION_XLSX_MIME_TYPE } = await import(
        "@/lib/export-report"
      );
      const bytes = createReconciliationXlsxReport({
        baseline,
        comparison,
        result,
        config: resultConfig,
      });
      downloadBytes(bytes, RECONCILIATION_XLSX_MIME_TYPE, "データ照合レポート.xlsx");
      setToast("Summary・差分・重複・エラーをSheet別に出力しました。");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Excelレポートを作成できませんでした。");
    } finally {
      setExportBusy(false);
    }
  };

  const exportCsv = async (selectedItems: readonly ReconciliationListItem[]) => {
    if (!result || !baseline || !comparison) return;
    if (isStale) {
      setGlobalError("条件変更後に再比較してからExportしてください。");
      return;
    }
    setExportBusy(true);
    try {
      const { createReconciliationCsvReport, RECONCILIATION_CSV_MIME_TYPE } = await import(
        "@/lib/export-report"
      );
      const bytes = createReconciliationCsvReport(
        { baseline, comparison, result, config: resultConfig },
        { items: selectedItems },
      );
      downloadBytes(bytes, RECONCILIATION_CSV_MIME_TYPE, "データ照合_表示結果.csv");
      setToast("現在のFilter結果をCSV出力しました。");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "CSVレポートを作成できませんでした。");
    } finally {
      setExportBusy(false);
    }
  };

  const copyResults = async (selectedItems: readonly ReconciliationListItem[]) => {
    if (isStale) {
      setGlobalError("条件変更後に再比較してからコピーしてください。");
      return;
    }
    const lines = selectedItems.slice(0, 5_000).map((item) => {
      if (item.kind === "record") {
        const changes = item.value.changes
          .map((change) => `${change.label}: ${String(change.before ?? "")} → ${String(change.after ?? "")}`)
          .join(" / ");
        return `${statusLabel(item.status)}\t${item.value.keyDisplay}\t${changes}`;
      }
      if (item.kind === "duplicate") {
        return `重複\t${item.value.keyDisplay}\t${item.value.duplicateSides.join("+")}`;
      }
      return `照合不能\t${item.value.keyDisplay}\t${item.value.message}`;
    });
    try {
      await navigator.clipboard.writeText([
        "判定\tKey\t差分内容",
        ...lines,
      ].join("\n"));
      setToast(`${lines.length.toLocaleString("ja-JP")}件をClipboardへコピーしました。`);
    } catch {
      setGlobalError("Clipboardへコピーできませんでした。ブラウザの権限を確認してください。");
    }
  };

  const mappingReady = canCompare;
  const workflowSteps = [
    { label: "ファイル", complete: Boolean(baseline && comparison) },
    { label: "Mapping / Key", complete: mappingReady },
    { label: "正規化", complete: mappingReady },
    { label: "差分検出", complete: Boolean(result && !isStale) },
    { label: "Filter / Export", complete: Boolean(result) },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ページ先頭へ">
          <Image
            className="brand__icon"
            src="/icons/reconciliation-mark.svg"
            width={40}
            height={40}
            alt=""
            loading="eager"
          />
          <span className="brand__copy">
            <strong>Excel・CSV差分比較</strong>
            <small>データ照合ツール</small>
          </span>
        </a>
        <nav className="topbar__nav" aria-label="ページ内ナビゲーション">
          <a href="#files">ファイル</a>
          <a href="#settings">照合条件</a>
          <a href="#results">結果</a>
        </nav>
        <div className="privacy-badge">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Local-first</span>
          <small>送信 0 byte</small>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__content">
            <p className="eyebrow">
              <span className="eyebrow__dot" aria-hidden="true" />
              DATA RECONCILIATION WORKFLOW
            </p>
            <h1 id="hero-title">Excel・CSV差分比較・データ照合ツール</h1>
            <p className="hero__lead">
              2つの表をKeyとColumn Mappingで対応付け、正規化してから
              <strong>Record・Cell単位</strong>の差分を決定論的に算出します。
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#files">
                <Play size={17} fill="currentColor" aria-hidden="true" />
                照合をはじめる
              </a>
              <span className="hero__format-note">
                <FileCheck2 size={16} aria-hidden="true" />
                CSV / XLSX · 最大25 MiB / file
              </span>
            </div>
          </div>
          <aside className="hero__trust-card" aria-label="処理方式">
            <div className="trust-card__icon" aria-hidden="true">
              <LockKeyhole size={24} />
            </div>
            <div>
              <span>YOUR DATA STAYS HERE</span>
              <strong>ファイルはブラウザの外へ出ません</strong>
              <p>解析・正規化・照合・レポート作成まで端末内で完結。入力内容は保存しません。</p>
            </div>
            <dl>
              <div><dt>Upload</dt><dd>0 byte</dd></div>
              <div><dt>Engine</dt><dd>Deterministic</dd></div>
            </dl>
          </aside>
        </section>

        <section className="workflow-strip" aria-labelledby="workflow-title">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="eyebrow">RECONCILIATION FLOW</p>
              <h2 id="workflow-title">照合作業を、ひとつの流れに</h2>
            </div>
            {durationMs !== null && result ? (
              <span className="run-metric">前回の照合 {durationMs.toLocaleString("ja-JP", { maximumFractionDigits: 1 })} ms</span>
            ) : null}
          </div>
          <ol
            className="workflow-steps"
            tabIndex={0}
            aria-label="照合作業の5ステップ。横方向にスクロールできます"
          >
            {workflowSteps.map((step, index) => (
              <li className={step.complete ? "workflow-step workflow-step--complete" : "workflow-step"} key={step.label}>
                <span>{step.complete ? <Check size={15} aria-hidden="true" /> : index + 1}</span>
                <strong>{step.label}</strong>
                {index < workflowSteps.length - 1 ? <ArrowDown className="workflow-step__arrow" size={15} aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="demo-section" aria-labelledby="demo-title">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="eyebrow"><Sparkles size={14} aria-hidden="true" /> DEMO MODE</p>
              <h2 id="demo-title">ファイルなしで、今すぐ試す</h2>
            </div>
            <p>すべて架空データです</p>
          </div>
          <div className="demo-grid">
            {DEMO_SCENARIOS.map((demo, index) => (
              <button
                className={activeDemoId === demo.id ? "demo-card demo-card--active" : "demo-card"}
                type="button"
                onClick={() => loadDemo(demo.id)}
                disabled={isInteractionLocked}
                aria-pressed={activeDemoId === demo.id}
                key={demo.id}
              >
                <span className="demo-card__number">0{index + 1}</span>
                <span className="demo-card__copy">
                  <strong>{demo.shortLabel}</strong>
                  <small>{demo.description}</small>
                </span>
                <span className="demo-card__action">
                  {activeDemoId === demo.id ? <><Check size={15} aria-hidden="true" /> 選択中</> : "読み込む"}
                </span>
              </button>
            ))}
          </div>
          {activeDemoId ? (
            <p className="demo-note" role="status">
              <ArrowLeftRight size={15} aria-hidden="true" />
              {getDemoScenario(activeDemoId).note}
            </p>
          ) : null}
        </section>

        {processingStage ? (
          <div className="processing-banner" role="status" aria-live="polite">
            <span className="processing-banner__spinner" aria-hidden="true" />
            <strong>{stageLabel(processingStage)}</strong>
            <span>進行率は推測せず、完了した工程だけを表示しています。</span>
          </div>
        ) : null}

        {globalError ? (
          <div className="global-alert" role="alert">
            <strong>確認してください</strong>
            <span>{globalError}</span>
            <button type="button" onClick={() => setGlobalError(null)} aria-label="エラーを閉じる">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <section id="files" className="files-section" aria-labelledby="files-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">STEP 1 · SOURCE FILES</p>
              <h2 id="files-title">比較する2つのデータ</h2>
              <p>左を基準、右を比較対象として読み込みます。ExcelはSheetを選択できます。</p>
            </div>
            <div className="source-legend" role="group" aria-label="比較方向">
              <span>A · 基準</span>
              <ArrowLeftRight size={18} aria-hidden="true" />
              <span>B · 比較</span>
            </div>
          </div>
          <div className="source-grid">
            <FileSourcePanel
              side="baseline"
              title="基準ファイル"
              importedFile={baselineFile}
              activeSheetIndex={baselineSheetIndex}
              busyStage={sourceBusy.baseline}
              disabled={isRunning || exportBusy}
              error={sourceErrors.baseline}
              onFile={(file) => handleFile("baseline", file)}
              onSheetChange={(index) => handleSheetChange("baseline", index)}
              onClear={() => clearSource("baseline")}
            />
            <FileSourcePanel
              side="comparison"
              title="比較ファイル"
              importedFile={comparisonFile}
              activeSheetIndex={comparisonSheetIndex}
              busyStage={sourceBusy.comparison}
              disabled={isRunning || exportBusy}
              error={sourceErrors.comparison}
              onFile={(file) => handleFile("comparison", file)}
              onSheetChange={(index) => handleSheetChange("comparison", index)}
              onClear={() => clearSource("comparison")}
            />
          </div>
        </section>

        {baseline && comparison ? (
          <section id="settings" className="settings-section" aria-label="照合条件">
            <ConfigurationPanel
              baseline={baseline}
              comparison={comparison}
              config={config}
              onConfigChange={markConfigurationChanged}
              templates={templates}
              onSaveTemplate={saveTemplate}
              onApplyTemplate={applyTemplate}
              onDeleteTemplate={deleteTemplate}
              onReset={resetConfiguration}
              onCompare={runComparison}
              isComparing={isInteractionLocked}
              isStale={isStale}
              canCompare={canCompare}
            />
          </section>
        ) : (
          <section id="settings" className="blocked-state" aria-live="polite">
            <LockKeyhole size={24} aria-hidden="true" />
            <h2>照合条件は2ファイル読込後に設定できます</h2>
            <p>上の左右ペインへCSVまたはXLSXを追加してください。</p>
          </section>
        )}

        {isStale ? (
          <div className="stale-banner" role="status">
            <span>照合条件が変更されています</span>
            <button
              className="button button--primary button--small"
              type="button"
              onClick={runComparison}
              disabled={!canCompare || isInteractionLocked}
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
              新しい条件で再比較
            </button>
          </div>
        ) : null}

        {baseline && comparison ? (
          <ResultsPanel
            result={result}
            resultRevision={resultRevision}
            baseline={baseline}
            comparison={comparison}
            config={resultConfig}
            isRunning={isRunning || hasSourceWork}
            isStale={isStale}
            stage={
              processingStage
                ? stageLabel(processingStage)
                : hasSourceWork
                  ? "ファイルを読み込んでいます"
                  : null
            }
            statuses={statuses}
            onStatusesChange={setStatuses}
            changedMappingIds={changedMappingIds}
            onChangedMappingIdsChange={setChangedMappingIds}
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            onExportXlsx={exportXlsx}
            onExportCsv={exportCsv}
            onCopy={copyResults}
            exportBusy={exportBusy}
          />
        ) : null}
      </main>

      <footer className="footer">
        <div className="footer__brand">
          <Image src="/icons/reconciliation-mark.svg" width={30} height={30} alt="" />
          <strong>Excel・CSV差分比較・データ照合ツール</strong>
        </div>
        <p>AIを使わない、決定論的な業務効率化ツール。入力データは端末内だけで処理されます。</p>
        <span>CSV / XLSX · Local-first · No upload</span>
      </footer>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <Check size={17} aria-hidden="true" />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="通知を閉じる">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
