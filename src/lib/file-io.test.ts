import { describe, expect, it, vi } from "vitest";
import {
  FileImportError,
  MAX_FILE_SIZE_BYTES,
  decodeCsvBuffer,
  detectCsvDelimiter,
  detectSupportedFileType,
  parseCsv,
  readBrowserFile,
  readDataFile,
} from "./file-io";
import { ROW_ID_KEY } from "./types";

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer,
    );
  }
  throw new TypeError("Expected binary output");
}

describe("CSV parsing", () => {
  it("parses BOM, quoted delimiters, escaped quotes, and embedded newlines", () => {
    const source =
      '\uFEFFname,,name,__rowId\r\n"Alice, A",x,duplicate,source\r\n"Bob\r\nB","He said ""hi""",duplicate2,source2\r\n';

    const result = parseCsv(source, { dataSetName: "customers" });

    expect(result.delimiter).toBe(",");
    expect(result.dataSet.headers).toEqual([
      "name",
      "列2",
      "name_2",
      "__rowId_2",
    ]);
    expect(result.dataSet.rows).toHaveLength(2);
    expect(result.dataSet.rows[0].name).toBe("Alice, A");
    expect(result.dataSet.rows[1].name).toBe("Bob\nB");
    expect(result.dataSet.rows[1]["列2"]).toBe('He said "hi"');
    expect(result.dataSet.rows[0][ROW_ID_KEY]).not.toBe("source");
    expect(result.dataSet.rows[0].__rowId_2).toBe("source");
  });

  it("detects tab, semicolon, and pipe delimiters from consistent logical rows", () => {
    expect(detectCsvDelimiter("姓\t名\n山田\t太郎\n")).toBe("\t");
    expect(detectCsvDelimiter("amount;memo\n1,200;paid\n2,300;open\n")).toBe(
      ";",
    );
    expect(detectCsvDelimiter("id|name\n1|Alice\n2|Bob\n")).toBe("|");
  });

  it("preserves source cell whitespace and leading zeroes before normalization", () => {
    const parsed = parseCsv(" 顧客ID , 氏名 \n 001 , Alice  \n");

    expect(parsed.dataSet.headers).toEqual(["顧客ID", "氏名"]);
    expect(parsed.dataSet.rows[0]).toMatchObject({
      顧客ID: " 001 ",
      氏名: " Alice  ",
    });
  });

  it("rejects empty input, a missing usable header, and an unterminated quote", () => {
    expect(() => parseCsv(" \r\n\t ")).toThrowError(
      expect.objectContaining({ code: "empty-file" }),
    );
    expect(() => parseCsv(",,\nA,B,C\n")).toThrowError(
      expect.objectContaining({ code: "missing-header" }),
    );
    expect(() => parseCsv('name,memo\nAlice,"not closed')).toThrowError(
      expect.objectContaining({ code: "csv-parse-error" }),
    );
  });

  it("rejects non-delimiter content after a quoted field instead of silently rewriting it", () => {
    expect(() => parseCsv('id,name\n1,"Alice"unexpected\n')).toThrowError(
      expect.objectContaining({ code: "csv-parse-error" }),
    );
    expect(() => parseCsv('id;name\n1;"Alice"unexpected\n')).toThrowError(
      expect.objectContaining({ code: "csv-parse-error" }),
    );
  });
});

describe("CSV decoding", () => {
  it("accepts strict UTF-8 and falls back to Shift-JIS", async () => {
    const source = "顧客名,都道府県\n山田太郎,東京都\n";
    const utf8 = new TextEncoder().encode(source);
    const decodedUtf8 = await decodeCsvBuffer(utf8);

    expect(decodedUtf8).toMatchObject({
      text: source,
      encoding: "utf-8",
      hadBom: false,
    });

    const Encoding = (await import("encoding-japanese")).default;
    const shiftJis = Uint8Array.from(
      Encoding.convert(Encoding.stringToCode(source), {
        from: "UNICODE",
        to: "SJIS",
        type: "array",
      }),
    );
    const decodedShiftJis = await decodeCsvBuffer(shiftJis);
    expect(decodedShiftJis).toMatchObject({
      text: source,
      encoding: "shift-jis",
      hadBom: false,
    });

    const imported = await readDataFile(shiftJis, {
      name: "customers.csv",
      size: shiftJis.byteLength,
    });
    expect(imported.metadata).toMatchObject({
      fileName: "customers.csv",
      fileType: "csv",
      encoding: "shift-jis",
      delimiter: ",",
      rowCount: 1,
      columnCount: 2,
      sheetNames: [],
    });
    expect(imported.dataSet.rows[0]["都道府県"]).toBe("東京都");
  });

  it("recognizes and removes a UTF-8 BOM", async () => {
    const content = new TextEncoder().encode("id,name\n1,Alice\n");
    const bytes = new Uint8Array(content.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(content, 3);

    await expect(decodeCsvBuffer(bytes)).resolves.toMatchObject({
      encoding: "utf-8",
      hadBom: true,
      text: "id,name\n1,Alice\n",
    });
  });
});

describe("XLSX parsing", () => {
  it("extracts every usable sheet, preserves typed cells, and reports metadata", async () => {
    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([
        ["顧客ID", "顧客名", "有効"],
        ["001", " 山田太郎 ", true],
      ]),
      "顧客一覧",
    );
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([
        ["商品コード", "価格"],
        ["P-001", 1200],
        ["P-002", 980],
      ]),
      "商品価格",
    );
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([]),
      "空シート",
    );
    const bytes = asBytes(
      xlsx.write(workbook, { type: "array", bookType: "xlsx" }),
    );

    const imported = await readDataFile(bytes, {
      name: "monthly.xlsx",
      size: bytes.byteLength,
    });

    expect(imported.metadata).toMatchObject({
      fileName: "monthly.xlsx",
      fileType: "xlsx",
      encoding: "binary",
      rowCount: 3,
      columnCount: 3,
      sheetNames: ["顧客一覧", "商品価格"],
      activeSheet: "顧客一覧",
      skippedSheetNames: ["空シート"],
    });
    expect(imported.dataSets).toHaveLength(2);
    expect(imported.dataSets[0].rows[0]).toMatchObject({
      顧客ID: "001",
      顧客名: " 山田太郎 ",
      有効: true,
    });
    expect(imported.dataSets[1].rows[0]).toMatchObject({
      商品コード: "P-001",
      価格: 1200,
    });
    expect(imported.dataSets[1].metadata?.source?.activeSheet).toBe("商品価格");
  });

  it("preserves an Excel local calendar date without a timezone day shift", async () => {
    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([
        ["日付"],
        [new Date(2026, 7, 22, 0, 0, 0)],
      ]),
      "日付",
    );
    const bytes = asBytes(
      xlsx.write(workbook, { type: "array", bookType: "xlsx" }),
    );

    const imported = await readDataFile(bytes, { name: "dates.xlsx" });
    expect(imported.dataSet.rows[0]["日付"]).toBe("2026-08-22");
  });

  it("rejects a workbook that has no usable header in any sheet", async () => {
    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([[null, ""], ["A", "B"]]),
      "headerless",
    );
    const bytes = asBytes(
      xlsx.write(workbook, { type: "array", bookType: "xlsx" }),
    );

    await expect(
      readDataFile(bytes, { name: "headerless.xlsx" }),
    ).rejects.toMatchObject({ code: "no-usable-sheet" });
  });
});

describe("file validation and browser adapter", () => {
  it("supports only CSV and XLSX by extension or an extensionless MIME type", () => {
    expect(detectSupportedFileType({ name: "DATA.XLSX" })).toBe("xlsx");
    expect(detectSupportedFileType({ name: "customers.csv" })).toBe("csv");
    expect(
      detectSupportedFileType({
        name: "upload",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe("xlsx");
    expect(() => detectSupportedFileType({ name: "legacy.xls" })).toThrowError(
      expect.objectContaining({ code: "unsupported-format" }),
    );
    expect(() => detectSupportedFileType({ name: "notes.txt" })).toThrowError(
      expect.objectContaining({ code: "unsupported-format" }),
    );
  });

  it("rejects empty and oversized files before calling arrayBuffer", async () => {
    const emptyReader = vi.fn(async () => new ArrayBuffer(0));
    const largeReader = vi.fn(async () => new ArrayBuffer(0));

    await expect(
      readBrowserFile({
        name: "empty.csv",
        size: 0,
        type: "text/csv",
        arrayBuffer: emptyReader,
      }),
    ).rejects.toMatchObject({ code: "empty-file" });
    await expect(
      readBrowserFile({
        name: "large.csv",
        size: MAX_FILE_SIZE_BYTES + 1,
        type: "text/csv",
        arrayBuffer: largeReader,
      }),
    ).rejects.toMatchObject({ code: "file-too-large" });
    expect(emptyReader).not.toHaveBeenCalled();
    expect(largeReader).not.toHaveBeenCalled();
  });

  it("uses a File-like ArrayBuffer adapter without requiring the File class", async () => {
    const bytes = new TextEncoder().encode("id,name\n1,Alice\n");
    const imported = await readBrowserFile({
      name: "users.csv",
      size: bytes.byteLength,
      type: "text/csv",
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
    });

    expect(imported.dataSet.rows[0]).toMatchObject({ id: "1", name: "Alice" });
    expect(imported.metadata.fileSize).toBe(bytes.byteLength);
  });

  it("exposes stable typed import errors", () => {
    const error = new FileImportError("unsupported-format", "unsupported");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "FileImportError",
      code: "unsupported-format",
      message: "unsupported",
    });
  });
});
