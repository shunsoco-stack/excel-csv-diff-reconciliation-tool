export default function Loading() {
  return (
    <main className="route-state" aria-busy="true" aria-live="polite">
      <div className="route-state__mark" aria-hidden="true" />
      <h1>照合ワークベンチを準備しています</h1>
      <p>ファイル処理は、このあとブラウザ内だけで行われます。</p>
    </main>
  );
}
