# ポートフォリオ掲載用ドキュメント

以下は、既存ポートフォリオへ作品を追加するときにそのまま利用できる事実ベースの掲載文と実装依頼Promptです。

## 掲載情報

| 項目 | 内容 |
| --- | --- |
| 作品名 | Excel・CSV差分比較・データ照合ツール |
| Category | 業務効率化ツール |
| Subcategory | データ照合・差分比較 |
| Production | https://excel-csv-diff-reconciliation-tool.vercel.app |
| Repository | https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool |
| README | https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool#readme |
| Icon | `public/icons/reconciliation-mark.svg` / `src/app/icon.svg` |

## 一覧カード用

### Title

Excel・CSV差分比較・データ照合ツール

### Short description

異なるExcel / CSVをKeyとColumn Mappingで対応付け、Normalization後にRecord・Cell単位の差分を決定論的に算出するLocal-first業務効率化ツール。

### Tags

`Next.js` `React` `TypeScript` `SheetJS` `Web Worker` `Deterministic Diff` `Composite Key` `Column Mapping` `Data Normalization` `Local-first`

### Links

- Demo: https://excel-csv-diff-reconciliation-tool.vercel.app
- GitHub: https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool

## 詳細ページ用本文

### 概要

「Excel・CSV差分比較・データ照合ツール」は、2つの表を単に行番号で比較するDiff Viewerではなく、異なる列名をColumn Mappingで対応付け、単一または複合KeyでRecordを照合し、正規化後の値を使って差分を決定論的に算出するWeb業務効率化ツールです。

ファイル読込、複数Sheet選択、Preview、Mapping、Key設定、Normalization、Added / Removed / Changed / Unchanged分類、Cell-level Diff、Filter、Export、Template再利用までを一つのData Reconciliation Workflowとして実装しました。

### 解決した課題

月次マスタ、商品価格改定、在庫台帳、旧・新システムExportなどの照合作業では、列名・表記・並び順の差を吸収しながら、どのRecordのどのCellが変わったかを確認する必要があります。表計算ソフト上の手作業では、重複KeyやKey欠損の見落とし、原データの上書き、条件の再現性不足が起きやすくなります。

本作では、Key・Mapping・Normalizationを明示的な設定として扱い、曖昧な重複は自動解決せず確認対象へ隔離しました。元データを保持したまま、同じ入力と条件から同じ結果を返す照合Engineにしています。

### 主な機能

- CSV / XLSXのDrag & Drop・File Selectと左右Preview
- XLSXの複数Sheet読込・Sheet選択
- 異なる列名のColumn Mappingと、明示適用式の類似候補
- 単一Key / 複合Key、比較対象列、除外列の設定
- Trim、大小文字、全角半角、改行、空文字 / null、数値、日付Normalization
- Added / Removed / Changed / Unchangedの決定論的分類
- Changed CellごとのColumn / Before / After表示
- Duplicate Key、Missing Key、Normalization Errorの検出
- Summary、差異率、一致率、Status / 変更列Filter、Search、Sort
- Mapping・Key・Normalization・FilterだけをlocalStorageへ保存するCompare Template
- Summaryを含む8 SheetのXLSXレポート、Filter済みCSV、Clipboard Copy
- 顧客マスタ、商品価格改定、在庫照合の3 Demo

### 技術的な見どころ

照合EngineはAIに依存せず、正規化済みKeyを`Map`で索引化する`O(rows × configured columns)`の決定論的実装です。Composite Keyは型付きTokenのJSON tupleとして直列化し、区切り文字を含む値でも衝突しないようにしました。

どちらかでKeyが重複した場合は、反対側の一意な行も含めてKey group全体を曖昧として隔離します。Missing Keyや指定形式へ変換できない値はfail closedでErrorへ分離し、通常Recordへ誤って混入させません。Normalizationは比較値にだけ適用し、画面とExportのBefore / Afterには元のCell値を残します。

ファイル解析・照合・レポート生成はBrowser / Web Worker内で完結します。入力ファイルや行データをServerへ送らず、Templateにも設定以外を保存しないLocal-first設計です。

### 使用技術

- Next.js 16.3 / React 19 / TypeScript 5.9
- SheetJS 0.20.3 / encoding-japanese 2.2
- Web Worker / Static Export
- Lucide React
- Vitest 4 / Testing Library / jsdom
- ESLint 9

### 品質

`npm run verify`でlint、typecheck、59 tests、Production buildを一括検証しています。自動テストにはCSV / XLSX parse、Composite Key、4分類、Duplicate、Missing Key、Normalization、Mapping、Template、Export、Filter / Sort、25件page、10,000行の照合が含まれます。

Vercel ProductionのBrowser QAでは、実CSV / XLSX、3 Demo、Template、Export、Clipboard生成、Desktop表示、390 × 844のMobile表示、document-levelの横overflowなしを確認しました。axe-core 4.12.1の自動監査はDesktop / Mobileともviolations 0、手動確認が必要なincomplete rule 1でした。

### 差別化

一般的なCSV / Excel変換ツールがFormatや構造を変換するのに対し、本作はDataset AとDataset BをMapping・Normalization・Matchingし、差異の意味をRecord・Cell単位で確認・再利用可能にするReconciliation Workflowです。

## Screenshot構成

1. `docs/screenshots/01-workbench-overview.png` — Landing、Local-first、Workflow、3 Demo
2. `docs/screenshots/02-cell-level-diff.png` — Changed、Before / After、Cell-level Diff
3. `docs/screenshots/03-column-mapping-key.png` — Column Mapping、Matching Key、Compare列
4. `docs/screenshots/04-status-filter-export.png` — Added / Removed / Duplicate、Filter、Export
5. `docs/screenshots/05-mobile-results.png` — Mobile判定Card / Cell-level Diff

Main thumbnailは1枚目を使用し、Local-first方針とWorkflowが一目で伝わるcropを推奨します。すべてVercel Productionの実画面から取得済みで、AI生成画像ではありません。

## 既存ポートフォリオへ追加するための完全版Prompt

```text
既存ポートフォリオへ、次の作品を新規追加してください。

作品名:
Excel・CSV差分比較・データ照合ツール

カテゴリ:
業務効率化ツール

サブカテゴリ:
データ照合・差分比較

本番URL:
https://excel-csv-diff-reconciliation-tool.vercel.app

GitHub Repository:
https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool

参照する一次情報:
- https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool のREADME.md
- https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool のpackage.json
- https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool のdocs/QA.md
- 専用Icon: public/icons/reconciliation-mark.svg
- 以下の本番Screenshot 5枚
  1. docs/screenshots/01-workbench-overview.png
  2. docs/screenshots/02-cell-level-diff.png
  3. docs/screenshots/03-column-mapping-key.png
  4. docs/screenshots/04-status-filter-export.png
  5. docs/screenshots/05-mobile-results.png

掲載時の必須方針:
1. 元の開発仕様ではなく、Repositoryと本番画面で確認できる実装済み機能だけを書く。
2. 「CSVを比較するViewer」ではなく、Key・Column Mapping・Normalization・Record / Cell Diff・Template再利用を一つにしたData Reconciliation Workflowとして説明する。
3. Deterministic Diff、Composite Key、Column Mapping、Data Normalization、Duplicate Detection、Cell-level Diff、Local-first Processing、Template Reuseを技術テーマとして強調する。
4. 主要処理にAIを使用していない、決定論的な業務効率化ツールであることを明記する。
5. CSV / XLSX対応、XLS非対応、1ファイル25 MiBという実際の対応範囲を正確に書く。
6. Browser / Web Worker内で解析・照合・Exportを行い、入力ファイルや行データをServerへ送信しないLocal-first設計を説明する。
7. Duplicate Keyは自動解決せずgroup全体を隔離し、Missing Key / Normalization Errorを別枠表示する点を説明する。
8. XLSXはSummary / Added / Removed / Changed / Unchanged / Duplicates / Diff Report / Errorsの8 Sheet、CSVは現在のFilter結果を出力する点を記載する。
9. 3つのDemo（顧客マスタ、商品価格改定、在庫照合）を紹介する。
10. QAはlint、typecheck、9 files / 59 tests、Production buildの実績を掲載する。本番QAの結果はdocs/QA.mdでPASSになっている項目だけを書く。
11. Main thumbnailには01-workbench-overview.pngを使用する。作品詳細では5枚を順番に配置し、各画像に内容を示すalt textを付ける。
12. DemoとGitHubへのCTAを明確に配置する。

推奨Short description:
「異なるExcel / CSVをKeyとColumn Mappingで対応付け、Normalization後にRecord・Cell単位の差分を決定論的に算出するLocal-first業務効率化ツール。」

実装後はDesktop / Mobileで表示を確認し、Link切れ、画像切れ、Console Errorがないことを確認してください。
```

## 公開前の置換・確認

- [x] Vercel Production URLを記載
- [x] public GitHub Repository URLを記載
- [x] 5枚の画像が本番実画面で、指定pathに存在することを確認
- [x] README / package.json / QAと掲載文に機能差異がないことを確認
- [x] 本番QAの実施結果をdocs/QA.mdへ記録
- [x] 専用IconがApp headerとfaviconで表示されることを確認
