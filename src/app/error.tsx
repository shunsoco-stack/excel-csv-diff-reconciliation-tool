"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="route-state" role="alert">
      <AlertTriangle size={32} aria-hidden="true" />
      <h1>画面の読み込みに失敗しました</h1>
      <p>入力ファイルは保存されていません。再読み込みして、もう一度お試しください。</p>
      <button className="button button--primary" type="button" onClick={reset}>
        <RotateCcw size={17} aria-hidden="true" />
        再読み込み
      </button>
    </main>
  );
}
