import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportedTabularFile } from "@/lib/file-io";
import { ROW_ID_KEY, type DataRow, type DataSet } from "@/lib/types";
import { FileSourcePanel, type FileSourcePanelProps } from "./file-source-panel";

afterEach(cleanup);

function dataSet(
  id: string,
  name: string,
  headers: string[],
  values: Array<Array<string | number | boolean | null>>,
): DataSet {
  return {
    id,
    name,
    headers,
    rows: values.map((valuesForRow, rowIndex) => {
      const row = { [ROW_ID_KEY]: `${id}-row-${rowIndex + 1}` } as DataRow;
      headers.forEach((header, columnIndex) => {
        row[header] = valuesForRow[columnIndex] ?? null;
      });
      return row;
    }),
  };
}

function importedWorkbook(): ImportedTabularFile {
  const customers = dataSet(
    "customers",
    "顧客一覧",
    ["顧客ID", "氏名", "有効"],
    [
      ["C-001", "山田 太郎", true],
      ["C-002", "佐藤 花子", true],
      ["C-003", "鈴木 一郎", false],
      ["C-004", "高橋 美咲", true],
      ["C-005", "伊藤 健", null],
    ],
  );
  const products = dataSet(
    "products",
    "商品価格",
    ["商品コード", "価格"],
    [["P-001", 1200]],
  );
  const metadata: ImportedTabularFile["metadata"] = {
    fileName: "monthly-customers.xlsx",
    fileType: "xlsx",
    fileSize: 1536,
    rowCount: 6,
    columnCount: 3,
    sheetNames: ["顧客一覧", "商品価格"],
    activeSheet: "顧客一覧",
    encoding: "binary",
  };
  return {
    dataSet: customers,
    dataSets: [customers, products],
    metadata,
  };
}

function defaultProps(
  overrides: Partial<FileSourcePanelProps> = {},
): FileSourcePanelProps {
  return {
    side: "baseline",
    title: "基準ファイル",
    importedFile: null,
    activeSheetIndex: 0,
    onFile: vi.fn(),
    onSheetChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe("FileSourcePanel", () => {
  it("offers an accessible local-first single-file CSV/XLSX empty state", () => {
    render(<FileSourcePanel {...defaultProps()} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "基準ファイル" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A · 基準")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "基準ファイルのアップロード領域" }),
    ).toBeInTheDocument();
    const input = screen.getByLabelText("基準ファイルを選択");
    expect(input).toHaveAttribute("type", "file");
    expect(input).not.toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".csv,.xlsx"));
    expect(
      screen.getByText("ファイルはブラウザ内で処理され、サーバーへ送信されません"),
    ).toBeInTheDocument();
    expect(screen.getByText("比較するファイルを追加してください")).toBeInTheDocument();
  });

  it("accepts one file from the picker or drag and drop", async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileSourcePanel {...defaultProps({ onFile })} />);
    const pickerFile = new File(["id,name\n1,Alice"], "customers.csv", {
      type: "text/csv",
    });
    const droppedFile = new File([new Uint8Array([1, 2, 3])], "customers.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await user.upload(screen.getByLabelText("基準ファイルを選択"), pickerFile);
    expect(onFile).toHaveBeenCalledWith(pickerFile);

    const dropZone = screen.getByRole("group", {
      name: "基準ファイルのアップロード領域",
    });
    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [droppedFile] } });
    expect(dropZone).toHaveClass("drop-zone--dragging");
    fireEvent.drop(dropZone, { dataTransfer: { files: [droppedFile] } });
    expect(onFile).toHaveBeenLastCalledWith(droppedFile);
    expect(dropZone).not.toHaveClass("drop-zone--dragging");
  });

  it("shows real active-sheet metadata and only the first four preview rows", async () => {
    const user = userEvent.setup();
    const onSheetChange = vi.fn();
    const onClear = vi.fn();
    render(
      <FileSourcePanel
        {...defaultProps({
          importedFile: importedWorkbook(),
          onSheetChange,
          onClear,
        })}
      />,
    );

    expect(screen.getByText("monthly-customers.xlsx")).toBeInTheDocument();
    expect(screen.getByText("XLSX")).toBeInTheDocument();
    const metadata = screen.getByLabelText("基準ファイルのファイル情報");
    expect(metadata).toHaveTextContent("サイズ1.5 KiB");
    expect(metadata).toHaveTextContent("行数5");
    expect(metadata).toHaveTextContent("列数3");

    const sheetSelector = screen.getByLabelText("比較対象シート");
    expect(sheetSelector).toHaveValue("0");
    expect(screen.getByRole("option", { name: "顧客一覧（5行）" })).toBeInTheDocument();
    await user.selectOptions(sheetSelector, "1");
    expect(onSheetChange).toHaveBeenCalledWith(1);

    const table = screen.getByRole("table", {
      name: "顧客一覧の先頭4行（全5行）",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByRole("columnheader", { name: "顧客ID" })).toBeInTheDocument();
    expect(within(table).getByText("C-004")).toBeInTheDocument();
    expect(within(table).queryByText("C-005")).not.toBeInTheDocument();
    expect(within(table).getByText("FALSE")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "基準ファイルをクリア" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("announces real busy and error states and disables file controls while busy", () => {
    const { rerender } = render(
      <FileSourcePanel {...defaultProps({ busyStage: "parsing" })} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("列と行を解析しています");
    expect(screen.getByLabelText("基準ファイルを選択")).toBeDisabled();
    expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeDisabled();

    rerender(
      <FileSourcePanel
        {...defaultProps({ error: "使用できるヘッダー行がありません。" })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "使用できるヘッダー行がありません。",
    );
    expect(
      screen.getByRole("button", { name: "基準ファイルをクリア" }),
    ).toBeEnabled();
  });
});
