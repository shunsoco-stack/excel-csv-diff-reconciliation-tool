import type {
  ProcessingStage,
  WorkerRequest,
  WorkerResponse,
  WorkerSuccess,
} from "./worker-protocol";

interface PendingRequest {
  resolve: (response: WorkerSuccess) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: ProcessingStage) => void;
}

export class ReconciliationWorkerClient {
  private worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(
      new URL("../workers/reconciliation.worker.ts", import.meta.url),
      { type: "module", name: "reconciliation-worker" },
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      if (response.kind === "progress") {
        pending.onProgress?.(response.stage);
        return;
      }
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response);
      else pending.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "ブラウザ内のデータ処理に失敗しました。");
      this.pending.forEach((pending) => pending.reject(error));
      this.pending.clear();
    };
    return worker;
  }

  request<T extends WorkerSuccess>(
    request: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (stage: ProcessingStage) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: (response) => resolve(response as T),
        reject,
        onProgress,
      });
      this.worker.postMessage(request, transfer);
    });
  }

  restart(reason = "新しい処理を開始しました。"): void {
    this.worker.terminate();
    this.pending.forEach((pending) => pending.reject(new Error(reason)));
    this.pending.clear();
    this.worker = this.createWorker();
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.forEach((pending) => pending.reject(new Error("処理を終了しました。")));
    this.pending.clear();
  }
}

export function createWorkerRequestId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
