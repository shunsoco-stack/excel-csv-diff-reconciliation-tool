"use client";

import {
  AlertCircle,
  FileSpreadsheet,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { ImportedTabularFile } from "@/lib/file-io";
import type { CellValue, DataSet } from "@/lib/types";

export type FileSourceSide = "baseline" | "comparison";

export interface FileSourcePanelProps {
  side: FileSourceSide;
  title: string;
  importedFile: ImportedTabularFile | null;
  activeSheetIndex: number;
  /** A real processing stage such as `reading` or `parsing`; no fake percentage is shown. */
  busyStage?: string | null;
  /** Locks source mutations while another workflow operation owns the data snapshot. */
  disabled?: boolean;
  error?: string | null;
  onFile: (file: File) => void | Promise<void>;
  onSheetChange: (sheetIndex: number) => void;
  onClear: () => void;
}

const PREVIEW_ROW_COUNT = 4;

const BUSY_LABELS: Readonly<Record<string, string>> = {
  loading: "ファイルを準備しています",
  reading: "ファイルを読み込んでいます",
  parsing: "列と行を解析しています",
};

function busyLabel(stage: string): string {
  return BUSY_LABELS[stage] ?? stage;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes).toLocaleString("ja-JP")} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString("ja-JP", {
      maximumFractionDigits: 1,
    })} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("ja-JP", {
    maximumFractionDigits: 1,
  })} MiB`;
}

function displayCellValue(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function activeDataSet(
  importedFile: ImportedTabularFile | null,
  requestedIndex: number,
): { dataSet: DataSet | null; index: number } {
  if (!importedFile || importedFile.dataSets.length === 0) {
    return { dataSet: null, index: 0 };
  }
  const index = Math.min(
    importedFile.dataSets.length - 1,
    Math.max(0, Math.trunc(requestedIndex)),
  );
  return { dataSet: importedFile.dataSets[index] ?? null, index };
}

export function FileSourcePanel({
  side,
  title,
  importedFile,
  activeSheetIndex,
  busyStage = null,
  disabled = false,
  error = null,
  onFile,
  onSheetChange,
  onClear,
}: FileSourcePanelProps) {
  const inputId = useId();
  const headingId = useId();
  const privacyId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isBusy = Boolean(busyStage);
  const controlsDisabled = isBusy || disabled;
  const { dataSet, index: safeSheetIndex } = activeDataSet(
    importedFile,
    activeSheetIndex,
  );

  const submitFile = (file: File | undefined) => {
    if (!file || controlsDisabled) return;
    void onFile(file);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    submitFile(event.currentTarget.files?.[0]);
    // Selecting the same file again must still trigger a change event.
    event.currentTarget.value = "";
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!controlsDisabled) setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = controlsDisabled ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    submitFile(event.dataTransfer.files?.[0]);
  };

  const sideLabel = side === "baseline" ? "A · 基準" : "B · 比較";
  const previewRows = dataSet?.rows.slice(0, PREVIEW_ROW_COUNT) ?? [];

  return (
    <section
      className={`source-panel source-panel--${side}`}
      aria-labelledby={headingId}
      aria-busy={isBusy || undefined}
      data-side={side}
    >
      <header className="source-panel__header">
        <div className="source-panel__heading-group">
          <span className="source-panel__side-label">{sideLabel}</span>
          <h2 id={headingId} className="source-panel__title">
            {title}
          </h2>
        </div>
        {(importedFile || error) && (
          <button
            type="button"
            className="source-panel__clear-button"
            onClick={onClear}
            disabled={controlsDisabled}
            aria-label={`${title}をクリア`}
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>クリア</span>
          </button>
        )}
      </header>

      <div
        className={`drop-zone${isDragging ? " drop-zone--dragging" : ""}${
          controlsDisabled ? " drop-zone--busy" : ""
        }${importedFile ? " drop-zone--compact" : ""}`}
        role="group"
        aria-label={`${title}のアップロード領域`}
        aria-disabled={controlsDisabled || undefined}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="drop-zone__input"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={controlsDisabled}
          aria-label={`${title}を選択`}
          aria-describedby={privacyId}
          onChange={handleInput}
        />

        <div className="drop-zone__icon" aria-hidden="true">
          <FileSpreadsheet size={24} strokeWidth={1.8} />
        </div>
        <div className="drop-zone__copy">
          <strong>
            {importedFile
              ? "別のCSV・XLSXに置き換える"
              : "CSV・XLSXをここへドロップ"}
          </strong>
          <span>1ファイル · 最大25 MiB</span>
        </div>
        <button
          type="button"
          className="drop-zone__select-button"
          onClick={() => inputRef.current?.click()}
          disabled={controlsDisabled}
        >
          <Upload size={16} aria-hidden="true" />
          ファイルを選択
        </button>
        <p id={privacyId} className="drop-zone__privacy-note">
          <LockKeyhole size={14} aria-hidden="true" />
          ファイルはブラウザ内で処理され、サーバーへ送信されません
        </p>
      </div>

      {isBusy && busyStage && (
        <div className="source-panel__loading" role="status" aria-live="polite">
          <LoaderCircle
            className="source-panel__loading-icon"
            size={17}
            aria-hidden="true"
          />
          <span>{busyLabel(busyStage)}</span>
        </div>
      )}

      {error && (
        <div className="source-panel__error" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <div className="source-panel__error-copy">
            <strong>ファイルを読み込めませんでした</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {!importedFile && !isBusy && !error && (
        <div className="source-panel__empty" role="status">
          <strong>比較するファイルを追加してください</strong>
          <span>列名と先頭4行を読み込み後に確認できます。</span>
        </div>
      )}

      {importedFile && dataSet && (
        <div className="source-panel__loaded">
          <div className="source-panel__file-row">
            <div className="source-panel__file-icon" aria-hidden="true">
              <FileSpreadsheet size={18} />
            </div>
            <div className="source-panel__file-copy">
              <strong title={importedFile.metadata.fileName}>
                {importedFile.metadata.fileName}
              </strong>
              <span>{importedFile.metadata.fileType.toUpperCase()}</span>
            </div>
          </div>

          <dl className="source-panel__metadata" aria-label={`${title}のファイル情報`}>
            <div className="source-panel__metadata-item">
              <dt>サイズ</dt>
              <dd>{formatFileSize(importedFile.metadata.fileSize)}</dd>
            </div>
            <div className="source-panel__metadata-item">
              <dt>行数</dt>
              <dd>{dataSet.rows.length.toLocaleString("ja-JP")}</dd>
            </div>
            <div className="source-panel__metadata-item">
              <dt>列数</dt>
              <dd>{dataSet.headers.length.toLocaleString("ja-JP")}</dd>
            </div>
          </dl>

          {importedFile.dataSets.length > 1 ? (
            <label className="source-panel__sheet-field">
              <span>比較対象シート</span>
              <select
                value={safeSheetIndex}
                onChange={(event) => onSheetChange(Number(event.currentTarget.value))}
                disabled={controlsDisabled}
              >
                {importedFile.dataSets.map((sheet, sheetIndex) => (
                  <option key={sheet.id} value={sheetIndex}>
                    {sheet.name}（{sheet.rows.length.toLocaleString("ja-JP")}行）
                  </option>
                ))}
              </select>
            </label>
          ) : importedFile.metadata.fileType === "xlsx" ? (
            <p className="source-panel__sheet-name">
              <span>Sheet</span>
              <strong>{dataSet.name}</strong>
            </p>
          ) : null}

          <div
            className="source-panel__preview-scroller"
            role="region"
            tabIndex={0}
            aria-label={`${title}のデータプレビュー。横方向にスクロールできます`}
          >
            <table className="source-panel__preview-table">
              <caption>
                {dataSet.rows.length === 0
                  ? `${dataSet.name}のヘッダー`
                  : `${dataSet.name}の先頭${previewRows.length}行（全${dataSet.rows.length.toLocaleString(
                      "ja-JP",
                    )}行）`}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="source-panel__row-number">
                    #
                  </th>
                  {dataSet.headers.map((header) => (
                    <th scope="col" key={header} title={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.length > 0 ? (
                  previewRows.map((row, rowIndex) => (
                    <tr key={row.__rowId}>
                      <th scope="row" className="source-panel__row-number">
                        {rowIndex + 1}
                      </th>
                      {dataSet.headers.map((header) => {
                        const value = row[header];
                        const empty = value === null || value === undefined || value === "";
                        return (
                          <td
                            key={header}
                            className={empty ? "source-panel__empty-cell" : undefined}
                            aria-label={empty ? `${header}: 空欄` : undefined}
                          >
                            {displayCellValue(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="source-panel__preview-empty"
                      colSpan={dataSet.headers.length + 1}
                    >
                      ヘッダーは読み込めましたが、データ行はありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
