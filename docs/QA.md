# QA Report

- 対象: **Excel・CSV差分比較・データ照合ツール**
- 記録日: 2026-08-22
- Production: [https://excel-csv-diff-reconciliation-tool.vercel.app](https://excel-csv-diff-reconciliation-tool.vercel.app)
- Repository: [https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool](https://github.com/shunsoco-stack/excel-csv-diff-reconciliation-tool)

> 自動テスト、ローカルProduction build、Vercel Productionの実ブラウザ検証を分離して記録しています。

## Current Status

| Gate | Result | Evidence |
| --- | --- | --- |
| ESLint | PASS | `npm run lint` exit 0 |
| TypeScript | PASS | `next typegen && tsc --noEmit` exit 0 |
| Unit / Component tests | PASS | 9 files / 59 tests |
| Production build | PASS | Next.js 16.3.2、5 static pages生成 |
| Dev browser smoke | PASS | Load、content、error overlay、page errors、主要UI |
| Dev responsive smoke | PASS | 390 × 844、document-level overflowなし、主要action表示 |
| Dev axe-core | PASS with manual review | violations 0 / incomplete 1 |
| Production smoke | PASS | Vercel READY、Desktop / Mobile、実CSV / XLSX、3 Demo、Export、consoleを確認 |

検証環境はNode.js v24.18.0 / npm 11.16.0です。`package.json`の実行要件はNode.js 22以上です。

## Quality Gate

実行Command:

```bash
npm run verify
```

実行結果:

```text
lint       PASS
typecheck  PASS
test       PASS  9 files / 59 tests
build      PASS  Next.js 16.3.2 static export

Static routes:
○ /
○ /_not-found
○ /icon.svg
○ /manifest.webmanifest
```

## Automated Test Coverage

| Test file | Tests | 主な検証対象 |
| --- | ---: | --- |
| `src/lib/file-io.test.ts` | 14 | CSV引用符・改行・delimiter、UTF-8 / Shift-JIS、XLSX multi-sheet・型・日付、validation |
| `src/lib/reconciliation.test.ts` | 18 | Normalization、4判定、Composite Key、Duplicate、Missing Key、設定Validation、Filter / Sort、10,000行 |
| `src/lib/demo-data.test.ts` | 3 | 3 Demo、全review state、数値比較、複合Key |
| `src/lib/mapping.test.ts` | 3 | Mapping候補、候補の非自動確定、Key候補、比較準備Validation |
| `src/lib/template-store.test.ts` | 3 | 設定のみの保存、version validation、列互換性 |
| `src/lib/export-report.test.ts` | 2 | 8 XLSX Sheet、raw value、Diff Report、BOM CSV、Filter、formula injection対策 |
| `src/components/file-source-panel.test.tsx` | 4 | File input / Drop、metadata、4行Preview、busy / error / accessibility |
| `src/components/configuration-panel.test.tsx` | 5 | Mapping / role / type、keyboard tabs、Normalization、Template操作 |
| `src/components/results-panel.test.tsx` | 7 | Summary、全結果種別、Filter / Sort / Export、stale output、empty recovery、25件page、row pointer安全性 |
| **Total** | **59** | **すべてPASS** |

### Large data correctness

自動生成した10,000 baseline rowsに、制御されたAdded / Removed / Changedを加えた照合テストが成功しています。今回の検証環境では57 msでしたが、分類の正当性を確認する回帰テストであり、端末ごとの処理時間SLAを保証するbenchmarkではありません。

## Browser QA — Development

開発Server `http://localhost:3100/` をChromium系の自動操作Browserで確認しました。

| Check | Result | 確認内容 |
| --- | --- | --- |
| Page load | PASS | TitleとURLを取得 |
| Blank page | PASS | `document.body.innerText.trim().length > 0` |
| Framework overlay | PASS | Next / Vite error overlayなし |
| Page errors | PASS | Browser page error一覧なし |
| Key UI | PASS | H1、3 Demo、左右Preview、Mapping、Key、Filter、Export、結果tableをaccessibility treeで確認 |
| Demo switch | PASS | 商品価格改定Demoへ切替後、6件＝Added 1 / Removed 1 / Changed 2 / Unchanged 2 |
| Mobile width | PASS | 390 × 844でH1、結果、Export actionsを表示 |
| Horizontal overflow | PASS | 390 px viewportでdocument全体の横overflowなし |

## Accessibility QA

### Automated audit

axe-core 4.12.1、WCAG 2 A / AA tags:

```text
Desktop violations: 0 / passes: 54 / incomplete rules: 1
Mobile  violations: 0 / passes: 55 / incomplete rules: 1
```

`incomplete`は背景合成やresponsive table表示により一部nodeのcontrastを自動判定できず、手動確認が必要という結果です。`violations: 0`はWCAG適合認証を意味しません。

### Code / component checks

- Document languageは`ja`
- H1 / H2 / H3とlandmarkを使用
- Tableにcaption、列・行Headerに`scope`
- File input、select、checkbox、searchへ明示Label
- Mapping / Preview / Resultの横scroll領域はfocus可能なnamed region
- TablistはArrow、Home、EndによるKeyboard移動をcomponent testで確認
- Loading / error / result変更は`aria-live`または`role=status|alert`
- Diffは色だけでなくStatus、Column、Before / After Labelを表示
- CSSに`focus-visible`、`prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`対応

### Remaining manual checks

- [ ] KeyboardだけでFile選択からExportまで完走
- [ ] NVDA / VoiceOver等による読み上げ順と操作確認
- [ ] axeが自動判定できなかった8 nodesの実測contrast確認
- [ ] 200% zoom / text spacingで情報欠落がないことを確認
- [ ] Touch targetを実機またはdevice emulationで確認

## Functional Acceptance Matrix

| Area | Automated | Dev browser | Production browser |
| --- | --- | --- | --- |
| CSV parse / validation | PASS | 実CSV 2件 PASS | PASS（実CSV 2件） |
| XLSX / multi-sheet parse | PASS | 2 Sheet切替 PASS | PASS（2 Sheet検出・切替） |
| Demo Mode 3種 | PASS | 商品Demo切替PASS | PASS（3種） |
| Column Mapping / candidate | PASS | Render確認 | PASS |
| Single / Composite Key | PASS | Render確認 | PASS（在庫Demoで2列Key） |
| Text / Number / Date Normalization | PASS | Render確認 | PASS（統合動作） |
| Added / Removed / Changed / Unchanged | PASS | Demo結果確認 | PASS（実CSVで1 / 1 / 1 / 2） |
| Cell-level Before / After | PASS | Render確認 | PASS（3 Cell差分） |
| Duplicate / Missing Key | PASS | Render確認 | PASS（各2） |
| Summary / rates | PASS | Render確認 | PASS（差異率60.0%、一致率40.0%） |
| Status / Column Filter、Search、Sort | PASS | 操作確認 | PASS（主要操作） |
| Compare Template | PASS | Render確認 | PASS（保存・削除、設定のみ1044 bytes） |
| XLSX / CSV Export | PASS（bytes再読込） | Blob生成確認 | PASS（20,639 / 2,445 bytes、MIME確認） |
| Clipboard | Component action確認 | 内容確認 | PASS（215文字のTSV生成を捕捉） |
| Desktop / Mobile | CSS・component | 390 px smoke PASS | PASS（390 px、overflow 0） |

## File Import Test Cases

### CSV

- UTF-8 / UTF-8 BOM / Shift-JIS
- comma / tab / semicolon / pipe delimiter
- quoted delimiter / escaped quote / Cell内改行
- 前後空白・leading zeroのraw value保持
- Empty file / Headerなし / unterminated quote
- 未対応format / 25 MiB超過

### XLSX

- 複数Sheetから利用可能Sheetを抽出
- 空Header Sheetのskipとskipped sheet metadata
- string / number / booleanの型保持
- Excel dateをBrowser timezoneで日ずれさせずlocal calendar文字列へ変換
- 利用可能Headerを持つSheetがないWorkbookの拒否

Browser用fixture:

- `tests/fixtures/qa-baseline.csv`
- `tests/fixtures/qa-comparison.csv`
- `tests/fixtures/qa-multisheet.xlsx`

## Reconciliation Invariants

1. 入力DataSetを変更しない。
2. 同じ入力と設定は同じ出力順・判定を返す。
3. Exact headerだけを初期Mappingとして確定し、類似候補は明示適用を待つ。
4. Composite Keyは型付きTokenのJSON tupleで直列化する。
5. `0` / `false`をMissing Keyにしない。
6. Composite Keyの1要素でも空欄なら照合不能にする。
7. どちらか一方で重複したKey groupは全行を通常照合から隔離する。
8. 不正なnumber / date normalizationはfail closedし、Errorとして保持する。
9. Before / AfterとExportには正規化後の値ではなくraw source valueを使用する。
10. Filter / Sortはengine outputを変更しない。

## Export QA

XLSXは生成byte列をSheetJSで再読込し、以下を検証しています。

- Sheet順: `Summary`, `Added`, `Removed`, `Changed`, `Unchanged`, `Duplicates`, `Diff Report`, `Errors`
- Summaryの各件数と設定情報
- Added / Removed / Changed / Unchangedのraw source values
- Diff ReportのKey / Column / Before / After
- Duplicate groupの関連行
- Errorの理由、対象列、元行
- Header filterとcolumn width metadata

CSVはUTF-8 BOM、CRLF、quoted field、all / filtered items、raw source columns、formula-like text protectionを検証しています。

## Production QA Checklist

`https://excel-csv-diff-reconciliation-tool.vercel.app`に対して実施しました。

- [x] Landingが表示され、blank page / error overlayがない
- [x] 3 Demoを切り替え、Summary・数値比較・複合Keyを確認
- [x] 実CSV 2ファイルを選択し、Mapping → Key → Compareを完走
- [x] multi-sheet XLSXを読み込み、2 Sheetの検出・切替を確認
- [x] Status Filter、Search、Sortを確認。25件pagingはcomponent testで確認
- [x] Templateの保存・削除と、行データを保存しないことを確認
- [x] XLSX / CSV Blobのファイル名・MIME・実byte数を本番で確認。内容再読込は自動テストで確認
- [x] Clipboardへ渡す215文字のTSVを捕捉して確認（自動Browserのread permissionは拒否）
- [x] Desktop viewportで全Workflow確認
- [x] Mobile 390 × 844で結果Cardとdocument-level overflow 0を確認
- [x] Browser console / page errorsがない
- [x] 本番画面から5枚のScreenshotを取得

## Production Screenshot Checklist

| # | File | 内容 | Status |
| ---: | --- | --- | --- |
| 1 | `docs/screenshots/01-workbench-overview.png` | Landing、Local-first、Workflow、3 Demo | PASS |
| 2 | `docs/screenshots/02-cell-level-diff.png` | Changed、Before / After | PASS |
| 3 | `docs/screenshots/03-column-mapping-key.png` | Preview、Mapping、Key、Compare列 | PASS |
| 4 | `docs/screenshots/04-status-filter-export.png` | Summary、Filter、Export、結果 | PASS |
| 5 | `docs/screenshots/05-mobile-results.png` | Mobile判定Card・Cell-level Diff | PASS |

5枚ともAI生成画像ではなく、Vercel Productionの実画面を保存します。

## Known QA Boundaries

- `tests/fixtures`はBrowser QA用であり、Unit testはbyte列・Workbookをtest内でも生成します。
- 10,000行testは正当性の回帰検証で、性能benchmarkではありません。
- Vercel ProductionのBlob downloadは自動Browserの保存UIではなく、同一page内で生成Blobを捕捉してファイル名・MIME・byte数を検証しています。
- Accessibilityの自動監査だけでは支援技術・Keyboard・zoomの手動確認を代替できません。
- XLSX formulaの再計算、XLS / ODS / password-protected workbookは検証対象外です。
