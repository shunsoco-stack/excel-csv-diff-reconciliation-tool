/// <reference lib="webworker" />

import { readDataFile } from "../lib/file-io";
import { reconcileDataSets } from "../lib/reconciliation";
import type { WorkerRequest, WorkerResponse } from "../lib/worker-protocol";

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(response: WorkerResponse): void {
  workerScope.postMessage(response);
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "parse") {
      post({ id: request.id, kind: "progress", stage: "parsing" });
      const result = await readDataFile(request.buffer, request.file);
      post({ id: request.id, kind: "parse", ok: true, result });
      return;
    }

    post({ id: request.id, kind: "progress", stage: "reconciling" });
    const start = performance.now();
    const result = reconcileDataSets(
      request.baseline,
      request.comparison,
      request.config,
    );
    post({ id: request.id, kind: "progress", stage: "report" });
    post({
      id: request.id,
      kind: "reconcile",
      ok: true,
      result,
      durationMs: performance.now() - start,
    });
  } catch (error) {
    post({
      id: request.id,
      kind: request.kind,
      ok: false,
      error: error instanceof Error ? error.message : "データ処理に失敗しました。",
    });
  }
};

export {};
