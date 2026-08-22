import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state">
      <p className="eyebrow">404</p>
      <h1>ページが見つかりません</h1>
      <Link className="button button--primary" href="/">
        照合ワークベンチへ戻る
      </Link>
    </main>
  );
}
