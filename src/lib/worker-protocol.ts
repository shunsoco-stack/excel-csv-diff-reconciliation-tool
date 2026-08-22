import type { ImportedTabularFile } from "./file-io";
import type {
  ReconciliationConfig,
  ReconciliationResult,
} from "./reconciliation";
import type { DataSet } from "./types";

export type ProcessingStage =
  | "reading"
  | "parsing"
  | "reconciling"
  | "report";

export type WorkerRequest =
  | {
      id: string;
      kind: "parse";
      buffer: ArrayBuffer;
      file: { name: string; size: number; type?: string };
    }
  | {
      id: string;
      kind: "reconcile";
      baseline: DataSet;
      comparison: DataSet;
      config: ReconciliationConfig;
    };

export type WorkerSuccess =
  | { id: string; kind: "parse"; ok: true; result: ImportedTabularFile }
  | {
      id: string;
      kind: "reconcile";
      ok: true;
      result: ReconciliationResult;
      durationMs: number;
    };

export interface WorkerFailure {
  id: string;
  kind: "parse" | "reconcile";
  ok: false;
  error: string;
}

export interface WorkerProgress {
  id: string;
  kind: "progress";
  stage: ProcessingStage;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure | WorkerProgress;
