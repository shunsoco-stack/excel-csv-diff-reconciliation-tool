import type { ImportedTabularFile, ImportedFileMetadata } from "./file-io";
import {
  DEFAULT_NORMALIZATION_OPTIONS,
  type ColumnMapping,
  type ReconciliationConfig,
} from "./reconciliation";
import { ROW_ID_KEY, type CellValue, type DataRow, type DataSet } from "./types";

export type DemoScenarioId = "customers" | "products" | "inventory";

export interface DemoScenario {
  id: DemoScenarioId;
  shortLabel: string;
  title: string;
  description: string;
  baseline: ImportedTabularFile;
  comparison: ImportedTabularFile;
  config: ReconciliationConfig;
  note: string;
}

function createDataSet(
  id: string,
  name: string,
  headers: string[],
  values: CellValue[][],
): DataSet {
  const rows = values.map((cells, rowIndex) => {
    const row = { [ROW_ID_KEY]: `${id}-row-${rowIndex + 1}` } as DataRow;
    headers.forEach((header, columnIndex) => {
      row[header] = cells[columnIndex] ?? null;
    });
    return row;
  });
  return { id, name, headers: [...headers], rows };
}

function createDemoFile(
  fileName: string,
  fileType: "csv" | "xlsx",
  dataSets: DataSet[],
): ImportedTabularFile {
  const sheetNames = fileType === "xlsx" ? dataSets.map((dataSet) => dataSet.name) : [];
  const metadata: ImportedFileMetadata = {
    fileName,
    fileType,
    fileSize: new TextEncoder().encode(JSON.stringify(dataSets)).byteLength,
    rowCount: dataSets.reduce((sum, dataSet) => sum + dataSet.rows.length, 0),
    columnCount: Math.max(...dataSets.map((dataSet) => dataSet.headers.length)),
    sheetNames,
    activeSheet: fileType === "xlsx" ? dataSets[0]?.name : undefined,
    encoding: fileType === "csv" ? "utf-8" : "binary",
    delimiter: fileType === "csv" ? "," : undefined,
  };
  const enriched = dataSets.map((dataSet) => ({
    ...dataSet,
    metadata: {
      source: { ...metadata, activeSheet: dataSet.name },
      description: "完全に架空のデモデータ",
    },
  }));
  return { dataSet: enriched[0], dataSets: enriched, metadata };
}

function createConfig(
  mappings: ColumnMapping[],
  keyMappingIds: string[],
  compareMappingIds: string[],
  typedMappings: Record<string, "number" | "date"> = {},
): ReconciliationConfig {
  return {
    version: 1,
    mappings,
    keyMappingIds,
    compareMappingIds,
    normalization: {
      ...DEFAULT_NORMALIZATION_OPTIONS,
      trim: true,
      caseInsensitive: true,
      width: "half",
      lineBreaks: "lf",
      emptyAsNull: true,
    },
    normalizationByMappingId: Object.fromEntries(
      Object.entries(typedMappings).map(([mappingId, valueType]) => [
        mappingId,
        { valueType },
      ]),
    ),
  };
}

const customerMappings: ColumnMapping[] = [
  { id: "customer-id", label: "顧客ID", baselineColumn: "顧客ID", comparisonColumn: "Customer ID" },
  { id: "customer-name", label: "氏名 / 会社名", baselineColumn: "氏名 / 会社名", comparisonColumn: "Customer Name" },
  { id: "customer-email", label: "メール", baselineColumn: "メール", comparisonColumn: "Email" },
  { id: "customer-prefecture", label: "都道府県", baselineColumn: "都道府県", comparisonColumn: "Prefecture" },
  { id: "customer-status", label: "ステータス", baselineColumn: "ステータス", comparisonColumn: "Status" },
  { id: "customer-updated", label: "更新日", baselineColumn: "更新日", comparisonColumn: "Updated At" },
];

const customerBaseline = createDemoFile(
  "顧客マスタ_2026-07.xlsx",
  "xlsx",
  [
    createDataSet(
      "customers-july",
      "顧客マスタ",
      ["顧客ID", "氏名 / 会社名", "メール", "都道府県", "ステータス", "更新日"],
      [
        ["C-1001", "アオバ商事", "CONTACT@AOBA.EXAMPLE ", "東京都", "継続", "2026/07/31"],
        ["C-1002", "月見テクノロジー", "hello@tsukimi.example", "大阪府", "継続", "2026/07/31"],
        ["C-1003", "港北デザイン", "info@kohoku.example", "神奈川県", "継続", "2026/07/31"],
        ["C-1004", "こもれび食品", "sales@komorebi.example", "長野県", "継続", "2026/07/31"],
        ["C-1005", "北星ロジスティクス", "desk@hokusei.example", "北海道", "継続", "2026/07/31"],
        ["C-1006", "さくら企画 東店", "east@sakura.example", "東京都", "継続", "2026/07/31"],
        ["C-1006", "さくら企画 西店", "west@sakura.example", "東京都", "継続", "2026/07/31"],
      ],
    ),
  ],
);

const customerComparison = createDemoFile(
  "顧客マスタ_2026-08.xlsx",
  "xlsx",
  [
    createDataSet(
      "customers-august",
      "Customers",
      ["Customer ID", "Customer Name", "Email", "Prefecture", "Status", "Updated At"],
      [
        ["Ｃ－１００１", "アオバ商事", "contact@aoba.example", "東京都", "継続", "2026-08-20"],
        ["C-1002", "月見テクノロジー", "hello@tsukimi.example", "大阪府", "退会", "2026-08-18"],
        ["C-1004", "こもれび食品", "support@komorebi.example", "群馬県", "継続", "2026-08-12"],
        ["C-1005", "北星ロジスティクス", "desk@hokusei.example", "北海道", "継続", "2026-08-01"],
        ["C-1006", "さくら企画", "office@sakura.example", "東京都", "継続", "2026-08-04"],
        ["C-1007", "白波マーケット", "hello@shiranami.example", "福岡県", "継続", "2026-08-21"],
        [null, "照合Key未登録", "missing@example.invalid", "東京都", "要確認", "2026-08-22"],
      ],
    ),
  ],
);

const productMappings: ColumnMapping[] = [
  { id: "product-code", label: "商品コード", baselineColumn: "商品コード", comparisonColumn: "SKU" },
  { id: "product-name", label: "商品名", baselineColumn: "商品名", comparisonColumn: "Product Name" },
  { id: "product-price", label: "価格", baselineColumn: "価格", comparisonColumn: "Price" },
  { id: "product-status", label: "販売状態", baselineColumn: "販売状態", comparisonColumn: "Status" },
  { id: "product-updated", label: "更新日時", baselineColumn: "更新日時", comparisonColumn: "Updated" },
];

const productBaseline = createDemoFile(
  "商品マスタ_改定前.xlsx",
  "xlsx",
  [
    createDataSet(
      "products-before",
      "商品マスタ",
      ["商品コード", "商品名", "価格", "販売状態", "更新日時"],
      [
        ["P-001", "リネンノート A5", "1,000", "販売中", "2026/08/01 09:00"],
        ["P-002", "デスクトレー", "2,800", "販売中", "2026/08/01 09:00"],
        ["P-003", "真鍮クリップ", "650", "販売中", "2026/08/01 09:00"],
        ["P-004", "ウールペンケース", "3,200", "販売中", "2026/08/01 09:00"],
        ["P-005", "方眼メモ", "480", "販売中", "2026/08/01 09:00"],
      ],
    ),
  ],
);

const productComparison = createDemoFile(
  "商品マスタ_改定後.xlsx",
  "xlsx",
  [
    createDataSet(
      "products-after",
      "Products",
      ["SKU", "Product Name", "Price", "Status", "Updated"],
      [
        ["P-001", "リネンノート A5", 1200, "販売中", "2026-08-20 10:00"],
        ["P-002", "デスクトレー", 2800, "販売終了", "2026-08-20 10:00"],
        ["P-003", "真鍮クリップ", 650, "販売中", "2026-08-20 10:00"],
        ["P-005", "方眼メモ", 480, "販売中", "2026-08-20 10:00"],
        ["P-006", "木製カードスタンド", 1500, "販売中", "2026-08-20 10:00"],
      ],
    ),
  ],
);

const inventoryMappings: ColumnMapping[] = [
  { id: "store-code", label: "店舗コード", baselineColumn: "店舗コード", comparisonColumn: "Store Code" },
  { id: "inventory-sku", label: "商品コード", baselineColumn: "商品コード", comparisonColumn: "SKU" },
  { id: "inventory-name", label: "商品名", baselineColumn: "商品名", comparisonColumn: "Item" },
  { id: "inventory-stock", label: "在庫数", baselineColumn: "システム在庫", comparisonColumn: "Counted Stock" },
];

const inventoryBaseline = createDemoFile(
  "システム在庫_2026-08-22.csv",
  "csv",
  [
    createDataSet(
      "inventory-system",
      "システム在庫_2026-08-22",
      ["店舗コード", "商品コード", "商品名", "システム在庫"],
      [
        ["TKY", "A-01", "リネンノート A5", "42"],
        ["TKY", "B-02", "デスクトレー", "18"],
        ["OSK", "A-01", "リネンノート A5", "30"],
        ["OSK", "C-03", "真鍮クリップ", "75"],
        ["FUK", "D-04", "方眼メモ", "120"],
      ],
    ),
  ],
);

const inventoryComparison = createDemoFile(
  "実棚卸_2026-08-22.csv",
  "csv",
  [
    createDataSet(
      "inventory-counted",
      "実棚卸_2026-08-22",
      ["Store Code", "SKU", "Item", "Counted Stock"],
      [
        ["TKY", "A-01", "リネンノート A5", "42.00"],
        ["TKY", "B-02", "デスクトレー", "15"],
        ["OSK", "A-01", "リネンノート A5", "34"],
        ["OSK", "C-03", "真鍮クリップ", "75"],
        ["FUK", "D-04", "方眼メモ", "118"],
      ],
    ),
  ],
);

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: "customers",
    shortLabel: "顧客マスタ",
    title: "月次の顧客マスタ差分",
    description: "新規・退会・住所／メール変更・一致・重複・Key欠損をまとめて確認します。",
    baseline: customerBaseline,
    comparison: customerComparison,
    config: createConfig(
      customerMappings,
      ["customer-id"],
      ["customer-name", "customer-email", "customer-prefecture", "customer-status"],
    ),
    note: "更新日は比較対象から除外。顧客IDの全角／半角とメールの大小文字は正規化します。",
  },
  {
    id: "products",
    shortLabel: "商品価格改定",
    title: "商品価格改定の確認",
    description: "商品追加・削除・価格改定・販売状態の変更を、SKU単位で照合します。",
    baseline: productBaseline,
    comparison: productComparison,
    config: createConfig(
      productMappings,
      ["product-code"],
      ["product-name", "product-price", "product-status"],
      { "product-price": "number" },
    ),
    note: "価格は数値として比較し、1,000・1000・1000.00を同一値として扱います。",
  },
  {
    id: "inventory",
    shortLabel: "在庫照合",
    title: "システム在庫 vs 実棚卸",
    description: "店舗コード＋商品コードの複合Keyで、一致・過剰・不足を検出します。",
    baseline: inventoryBaseline,
    comparison: inventoryComparison,
    config: createConfig(
      inventoryMappings,
      ["store-code", "inventory-sku"],
      ["inventory-name", "inventory-stock"],
      { "inventory-stock": "number" },
    ),
    note: "複合Keyを使用。在庫数は数値として比較し、差異のBefore / Afterを表示します。",
  },
] as const;

export function getDemoScenario(id: DemoScenarioId): DemoScenario {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEMO_SCENARIOS[0];
}
