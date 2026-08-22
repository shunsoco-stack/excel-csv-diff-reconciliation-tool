import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NORMALIZATION_OPTIONS,
  reconcileDataSets,
  type ColumnMapping,
  type ReconciliationConfig,
  type ResultFilterStatus,
} from "@/lib/reconciliation";
import { ROW_ID_KEY, type CellValue, type DataRow, type DataSet } from "@/lib/types";
import { ResultsPanel, type ResultsPanelProps } from "./results-panel";

afterEach(cleanup);

const ALL_STATUSES: ResultFilterStatus[] = [
  "added",
  "removed",
  "changed",
  "unchanged",
  "duplicate",
  "error",
];

function dataSet(
  id: string,
  headers: string[],
  records: readonly (readonly CellValue[])[],
): DataSet {
  return {
    id,
    name: id,
    headers,
    rows: records.map((values, rowIndex) => {
      const row = { [ROW_ID_KEY]: `${id}-row-${rowIndex + 1}` } as DataRow;
      headers.forEach((header, columnIndex) => {
        row[header] = values[columnIndex] ?? null;
      });
      return row;
    }),
  };
}

const fixtureMappings: ColumnMapping[] = [
  { id: "id", label: "顧客ID", baselineColumn: "顧客ID", comparisonColumn: "customerId" },
  { id: "name", label: "名称", baselineColumn: "名称", comparisonColumn: "name" },
  { id: "price", label: "価格", baselineColumn: "価格", comparisonColumn: "price" },
];

const fixtureConfig: ReconciliationConfig = {
  version: 1,
  mappings: fixtureMappings,
  keyMappingIds: ["id"],
  compareMappingIds: ["name", "price"],
  normalization: { ...DEFAULT_NORMALIZATION_OPTIONS, trim: true },
  normalizationByMappingId: { price: { valueType: "number" } },
};

function completeFixture() {
  const baseline = dataSet(
    "baseline",
    ["顧客ID", "名称", "価格"],
    [
      ["A", "Alpha", 10],
      ["B", "Beta", 20],
      ["C", "Gamma", 30],
      ["D", "Duplicate one", 40],
      ["D", "Duplicate two", 41],
      [null, "Missing baseline key", 50],
    ],
  );
  const comparison = dataSet(
    "comparison",
    ["customerId", "name", "price"],
    [
      ["A", "Alpha", "10.00"],
      ["B", "Beta Updated", "25"],
      ["E", "Epsilon", "50"],
      ["D", "Duplicate counterpart", "40"],
      ["", "Missing comparison key", "50"],
    ],
  );
  return {
    baseline,
    comparison,
    result: reconcileDataSets(baseline, comparison, fixtureConfig),
  };
}

function props(
  overrides: Partial<ResultsPanelProps> = {},
): ResultsPanelProps {
  const fixture = completeFixture();
  return {
    result: fixture.result,
    resultRevision: 0,
    baseline: fixture.baseline,
    comparison: fixture.comparison,
    config: fixtureConfig,
    isRunning: false,
    isStale: false,
    statuses: [...ALL_STATUSES],
    onStatusesChange: vi.fn(),
    changedMappingIds: [],
    onChangedMappingIdsChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    sort: "source",
    onSortChange: vi.fn(),
    onExportXlsx: vi.fn(),
    onExportCsv: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  };
}

describe("ResultsPanel", () => {
  it("announces accessible empty and real-stage loading states", () => {
    const initial = props({ result: null });
    const { rerender } = render(<ResultsPanel {...initial} />);

    expect(screen.getByRole("heading", { level: 2, name: "照合結果" })).toBeInTheDocument();
    expect(screen.getByText("まだ照合結果はありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "XLSXレポート" })).toBeDisabled();

    rerender(<ResultsPanel {...initial} isRunning stage="normalizing" />);
    expect(screen.getByRole("status")).toHaveTextContent("比較値を正規化しています");
    expect(screen.getByRole("button", { name: "CSV出力" })).toBeDisabled();
    expect(screen.queryByText("まだ照合結果はありません")).not.toBeInTheDocument();
  });

  it("renders real summary counts and explicit details for every result kind", () => {
    render(<ResultsPanel {...props()} />);

    const summary = screen.getByLabelText("照合結果サマリー");
    expect(summary).toHaveTextContent("照合対象4");
    expect(summary).toHaveTextContent("追加1");
    expect(summary).toHaveTextContent("削除1");
    expect(summary).toHaveTextContent("変更1");
    expect(summary).toHaveTextContent("一致1");
    expect(summary).toHaveTextContent("重複Key1");
    expect(summary).toHaveTextContent("要確認行2");
    expect(summary).toHaveTextContent("差異率75.0%");
    expect(summary).toHaveTextContent("一致率25.0%");

    const table = screen.getByRole("table", { name: /絞り込み結果 7件/ });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getAllByText("Before")).toHaveLength(2);
    expect(within(table).getAllByText("After")).toHaveLength(2);
    expect(within(table).getByText("Beta")).toBeInTheDocument();
    expect(within(table).getByText("Beta Updated")).toBeInTheDocument();
    expect(within(table).getByText("20")).toBeInTheDocument();
    expect(within(table).getByText("25")).toBeInTheDocument();

    expect(within(table).getByText("比較データ · comparison · 3行目")).toBeInTheDocument();
    expect(within(table).getByText("Epsilon")).toBeInTheDocument();
    expect(within(table).getByText("基準データ · baseline · 3行目")).toBeInTheDocument();
    expect(within(table).getByText("Gamma")).toBeInTheDocument();
    expect(within(table).getByText("重複側: 基準")).toBeInTheDocument();
    expect(within(table).getByText("基準 2行 / 比較 1行")).toBeInTheDocument();
    expect(within(table).getByText("基準データ · baseline · 6行目")).toBeInTheDocument();
    expect(within(table).getByText("比較データ · comparison · 5行目")).toBeInTheDocument();

    const detailCell = within(table).getByText("Beta Updated").closest("td");
    expect(detailCell).toHaveAttribute("data-label", "内容");
    expect(within(table).getAllByText("変更", { selector: "span" }).length).toBeGreaterThan(0);
  });

  it("exposes controlled filters, sorting, and all export actions", async () => {
    const user = userEvent.setup();
    const onStatusesChange = vi.fn();
    const onChangedMappingIdsChange = vi.fn();
    const onSearchChange = vi.fn();
    const onSortChange = vi.fn();
    const onExportXlsx = vi.fn();
    const onExportCsv = vi.fn();
    const onCopy = vi.fn();
    render(
      <ResultsPanel
        {...props({
          onStatusesChange,
          onChangedMappingIdsChange,
          onSearchChange,
          onSortChange,
          onExportXlsx,
          onExportCsv,
          onCopy,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "変更 1件を非表示にする" }));
    expect(onStatusesChange).toHaveBeenCalledWith([
      "added",
      "removed",
      "unchanged",
      "duplicate",
      "error",
    ]);

    await user.type(screen.getByLabelText("Key・名称を検索"), "Beta");
    expect(onSearchChange).toHaveBeenLastCalledWith("a");

    await user.selectOptions(screen.getByLabelText("変更列で絞り込む"), "price");
    expect(onChangedMappingIdsChange).toHaveBeenCalledWith(["price"]);

    await user.selectOptions(screen.getByLabelText("並び順"), "changes-desc");
    expect(onSortChange).toHaveBeenCalledWith("changes-desc");

    await user.click(screen.getByRole("button", { name: "XLSXレポート" }));
    await user.click(screen.getByRole("button", { name: "CSV出力" }));
    await user.click(screen.getByRole("button", { name: "表示結果をコピー" }));
    expect(onExportXlsx).toHaveBeenCalledOnce();
    expect(onExportCsv).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("disables every output action while the visible result is stale", () => {
    render(<ResultsPanel {...props({ isStale: true })} />);

    expect(screen.getByRole("button", { name: "XLSXレポート" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "CSV出力" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "表示結果をコピー" })).toBeDisabled();
  });

  it("offers one-step recovery when controlled filters hide every row", async () => {
    const user = userEvent.setup();
    const onStatusesChange = vi.fn();
    const onChangedMappingIdsChange = vi.fn();
    const onSearchChange = vi.fn();
    render(
      <ResultsPanel
        {...props({
          statuses: [],
          changedMappingIds: ["price"],
          search: "does-not-exist",
          onStatusesChange,
          onChangedMappingIdsChange,
          onSearchChange,
        })}
      />,
    );

    expect(screen.getByText("条件に一致する結果がありません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "絞り込みを解除" }));
    expect(onStatusesChange).toHaveBeenCalledWith(ALL_STATUSES);
    expect(onChangedMappingIdsChange).toHaveBeenCalledWith([]);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("renders at most 25 result rows per semantic table page", async () => {
    const user = userEvent.setup();
    const mappings: ColumnMapping[] = [
      { id: "id", label: "ID", baselineColumn: "id", comparisonColumn: "id" },
    ];
    const config: ReconciliationConfig = {
      version: 1,
      mappings,
      keyMappingIds: ["id"],
      compareMappingIds: [],
      normalization: { ...DEFAULT_NORMALIZATION_OPTIONS },
    };
    const baseline = dataSet("empty-baseline", ["id"], []);
    const comparison = dataSet(
      "thirty-comparison",
      ["id"],
      Array.from({ length: 30 }, (_, index) => [`ID-${String(index).padStart(2, "0")}`]),
    );
    const result = reconcileDataSets(baseline, comparison, config);
    const panelProps = props({
      baseline,
      comparison,
      config,
      result,
      statuses: ["added"],
    });
    const { rerender } = render(
      <ResultsPanel
        {...panelProps}
      />,
    );

    const firstPage = screen.getByRole("table", { name: /絞り込み結果 30件/ });
    expect(within(firstPage).getAllByRole("row")).toHaveLength(26);
    expect(within(firstPage).getByText("ID-24", { selector: "strong" })).toBeInTheDocument();
    expect(within(firstPage).queryByText("ID-25", { selector: "strong" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "次の25件" }));
    const secondPage = screen.getByRole("table", { name: /26〜30件/ });
    expect(within(secondPage).getAllByRole("row")).toHaveLength(6);
    expect(within(secondPage).getByText("ID-25", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("2 / 2ページ · 全30件")).toBeInTheDocument();

    rerender(<ResultsPanel {...panelProps} resultRevision={1} />);
    expect(screen.getByText("1 / 2ページ · 全30件")).toBeInTheDocument();
    expect(screen.getByText("ID-00", { selector: "strong" })).toBeInTheDocument();
  });

  it("does not resolve a stale row pointer to the wrong source row", () => {
    const fixture = completeFixture();
    const staleComparison: DataSet = {
      ...fixture.comparison,
      rows: fixture.comparison.rows.filter((row) => row.customerId !== "E"),
    };
    render(
      <ResultsPanel
        {...props({
          result: fixture.result,
          baseline: fixture.baseline,
          comparison: staleComparison,
          statuses: ["added"],
        })}
      />,
    );

    expect(screen.getByText("元の行を参照できません。条件を確認して再照合してください。"))
      .toBeInTheDocument();
    expect(screen.queryByText("Duplicate counterpart")).not.toBeInTheDocument();
  });
});
