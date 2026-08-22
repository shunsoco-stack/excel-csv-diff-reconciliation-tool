import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Excel・CSV差分比較・データ照合ツール",
  description:
    "2つのExcel・CSVをKeyとColumn Mappingで照合し、追加・削除・変更・一致・重複をブラウザ内で検出する業務効率化ツールです。",
  applicationName: "Excel・CSV差分比較・データ照合ツール",
  keywords: [
    "Excel 差分比較",
    "CSV 差分比較",
    "データ照合",
    "Column Mapping",
    "Local-first",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123f46",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
