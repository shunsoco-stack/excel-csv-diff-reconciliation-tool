import * as XLSX from "xlsx";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

XLSX.set_fs(fs);

const workbook = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([
    ["顧客ID", "氏名", "メール", "部署", "契約金額"],
    ["C001", "青木 葵", "aoki@example.jp", "営業", 120000],
    ["C002", "井上 蓮", "inoue@example.jp", "企画", 98000],
    ["C003", "上田 凛", "ueda@example.jp", "開発", 150000],
  ]),
  "顧客マスタ",
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([
    ["商品コード", "商品名", "単価"],
    ["P-001", "デスクライト", 7800],
    ["P-002", "モニターアーム", 12600],
  ]),
  "商品マスタ",
);

XLSX.writeFile(
  workbook,
  fileURLToPath(new URL("../tests/fixtures/qa-multisheet.xlsx", import.meta.url)),
);
