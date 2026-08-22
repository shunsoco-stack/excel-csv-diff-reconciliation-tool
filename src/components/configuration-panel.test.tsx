import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReconciliationConfig } from "@/lib/reconciliation";
import type { ReconciliationTemplate } from "@/lib/template-store";
import { ROW_ID_KEY, type DataSet } from "@/lib/types";
import {
  ConfigurationPanel,
  type ConfigurationPanelProps,
} from "./configuration-panel";

afterEach(cleanup);

const NORMALIZATION: ReconciliationConfig["normalization"] = {
  trim: true,
  caseInsensitive: false,
  width: "none",
  lineBreaks: "lf",
  emptyAsNull: true,
  valueType: "text",
};

function dataSet(id: string, headers: string[]): DataSet {
  return {
    id,
    name: id,
    headers,
    rows: [{ [ROW_ID_KEY]: `${id}-row-1` }],
  };
}

function configuration(
  overrides: Partial<ReconciliationConfig> = {},
): ReconciliationConfig {
  return {
    version: 1,
    mappings: [
      {
        id: "mapping-2",
        label: "氏名",
        baselineColumn: "氏名",
        comparisonColumn: "氏名",
      },
    ],
    keyMappingIds: [],
    compareMappingIds: ["mapping-2"],
    normalization: NORMALIZATION,
    ...overrides,
  };
}

function defaultProps(
  overrides: Partial<ConfigurationPanelProps> = {},
): ConfigurationPanelProps {
  return {
    baseline: dataSet("baseline", ["customer_id", "氏名", "金額"]),
    comparison: dataSet("comparison", ["customerId", "氏名", "Amount"]),
    config: configuration(),
    onConfigChange: vi.fn(),
    templates: [],
    onSaveTemplate: vi.fn(),
    onApplyTemplate: vi.fn(),
    onDeleteTemplate: vi.fn(),
    onReset: vi.fn(),
    onCompare: vi.fn(),
    isComparing: false,
    isStale: false,
    canCompare: false,
    ...overrides,
  };
}

function validConfig(): ReconciliationConfig {
  return configuration({
    mappings: [
      {
        id: "mapping-1",
        label: "customer_id",
        baselineColumn: "customer_id",
        comparisonColumn: "customerId",
      },
      {
        id: "mapping-2",
        label: "氏名",
        baselineColumn: "氏名",
        comparisonColumn: "氏名",
      },
    ],
    keyMappingIds: ["mapping-1"],
    compareMappingIds: ["mapping-2"],
  });
}

function template(config = validConfig()): ReconciliationTemplate {
  return {
    version: 1,
    id: "template-monthly",
    name: "月次顧客マスタ",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    baselineHeaders: ["customer_id", "氏名", "金額"],
    comparisonHeaders: ["customerId", "氏名", "Amount"],
    config,
    resultFilter: ["added", "removed", "changed"],
  };
}

describe("ConfigurationPanel", () => {
  it("keeps fuzzy mapping suggestions explicit and assigns the stable baseline ID", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(<ConfigurationPanel {...defaultProps({ onConfigChange })} />);

    expect(onConfigChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("customer_idの比較データ列")).toHaveValue("");
    expect(screen.getByText("表記ゆれ · 98%")).toBeInTheDocument();
    expect(screen.getByText("Key候補")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "customer_idに候補のcustomerIdを適用",
      }),
    );

    expect(onConfigChange).toHaveBeenCalledOnce();
    expect(onConfigChange.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        mappings: [
          expect.objectContaining({
            id: "mapping-1",
            baselineColumn: "customer_id",
            comparisonColumn: "customerId",
          }),
          expect.objectContaining({ id: "mapping-2" }),
        ],
      }),
    );
  });

  it("removes roles and per-column overrides when a mapping is cleared", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const config = configuration({
      mappings: [
        {
          id: "legacy-customer-id",
          label: "customer_id",
          baselineColumn: "customer_id",
          comparisonColumn: "customerId",
        },
        {
          id: "mapping-2",
          label: "氏名",
          baselineColumn: "氏名",
          comparisonColumn: "氏名",
        },
      ],
      keyMappingIds: ["legacy-customer-id", "mapping-1"],
      compareMappingIds: ["mapping-2", "mapping-1"],
      normalizationByMappingId: {
        "legacy-customer-id": { valueType: "number" },
        "mapping-1": { trim: false },
        "mapping-2": { caseInsensitive: true },
      },
    });
    render(<ConfigurationPanel {...defaultProps({ config, onConfigChange })} />);

    await user.selectOptions(
      screen.getByLabelText("customer_idの比較データ列"),
      "",
    );

    const next = onConfigChange.mock.calls[0][0] as ReconciliationConfig;
    expect(next.mappings.map((mapping) => mapping.id)).toEqual(["mapping-2"]);
    expect(next.keyMappingIds).toEqual([]);
    expect(next.compareMappingIds).toEqual(["mapping-2"]);
    expect(next.normalizationByMappingId).toEqual({
      "mapping-2": { caseInsensitive: true },
    });
  });

  it("updates roles and comparison type and enables comparison only for a valid setup", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();
    const onConfigChange = vi.fn();
    render(
      <ConfigurationPanel
        {...defaultProps({
          config: validConfig(),
          onCompare,
          onConfigChange,
          isStale: true,
          canCompare: true,
        })}
      />,
    );

    expect(screen.getByLabelText("customer_idを照合Keyにする")).toBeChecked();
    expect(screen.getByLabelText("氏名を比較対象にする")).toBeChecked();
    expect(screen.getByLabelText("現在の照合設定")).toHaveTextContent(
      "2 Mapping1 Key1 Compare",
    );

    await user.selectOptions(screen.getByLabelText("氏名の比較形式"), "number");
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        normalizationByMappingId: {
          "mapping-2": { valueType: "number" },
        },
      }),
    );

    const compareButton = screen.getByRole("button", {
      name: "この設定で再比較",
    });
    expect(compareButton).toBeEnabled();
    await user.click(compareButton);
    expect(onCompare).toHaveBeenCalledOnce();
  });

  it("supports keyboard tabs and emits normalization changes without touching source rows", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const baseline = defaultProps().baseline;
    const originalRows = structuredClone(baseline.rows);
    render(
      <ConfigurationPanel
        {...defaultProps({ baseline, onConfigChange })}
      />,
    );

    const mappingTab = screen.getByRole("tab", { name: "Mapping" });
    fireEvent.keyDown(mappingTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Normalization" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: "大文字・小文字を区別しない",
      }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        normalization: expect.objectContaining({ caseInsensitive: true }),
      }),
    );
    expect(baseline.rows).toEqual(originalRows);
  });

  it("saves, applies, and deletes compatible templates with a privacy notice", async () => {
    const user = userEvent.setup();
    const onSaveTemplate = vi.fn();
    const onApplyTemplate = vi.fn();
    const onDeleteTemplate = vi.fn();
    render(
      <ConfigurationPanel
        {...defaultProps({
          config: validConfig(),
          templates: [template()],
          onSaveTemplate,
          onApplyTemplate,
          onDeleteTemplate,
        })}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Templates" }));
    expect(
      screen.getByText("ファイル本体・行データ・セル値はテンプレートへ保存されません。"),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText("テンプレート名");
    await user.type(nameInput, "  四半期照合  ");
    await user.click(screen.getByRole("button", { name: "現在の設定を保存" }));
    expect(onSaveTemplate).toHaveBeenCalledWith("四半期照合");
    expect(nameInput).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "適用" }));
    expect(onApplyTemplate).toHaveBeenCalledWith("template-monthly");
    await user.click(
      screen.getByRole("button", { name: "月次顧客マスタを削除" }),
    );
    expect(onDeleteTemplate).toHaveBeenCalledWith("template-monthly");
  });
});
