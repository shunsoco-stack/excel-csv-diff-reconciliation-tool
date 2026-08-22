import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Excel・CSV差分比較・データ照合ツール",
    short_name: "データ照合ツール",
    description: "Excel・CSVをブラウザ内で安全に差分比較します。",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f3",
    theme_color: "#123f46",
    lang: "ja",
    icons: [
      {
        src: "/icons/reconciliation-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
