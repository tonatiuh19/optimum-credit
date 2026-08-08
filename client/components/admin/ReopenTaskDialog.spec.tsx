import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import ReopenTaskDialog, {
  shouldWarnReopenRollback,
} from "@/components/admin/ReopenTaskDialog";

describe("shouldWarnReopenRollback", () => {
  it("skips new_client and prospect", () => {
    expect(
      shouldWarnReopenRollback("new_client", {
        task_type: "upload",
        is_required: 1,
      }),
    ).toBe(false);
    expect(
      shouldWarnReopenRollback("prospect", { task_type: "upload" }),
    ).toBe(false);
  });

  it("warns for required / upload / sign mid-pipeline", () => {
    expect(
      shouldWarnReopenRollback("round_1", { task_type: "upload" }),
    ).toBe(true);
    expect(
      shouldWarnReopenRollback("docs_ready", { task_type: "sign_document" }),
    ).toBe(true);
    expect(
      shouldWarnReopenRollback("round_2", {
        task_type: "form",
        is_required: 1,
      }),
    ).toBe(true);
    expect(
      shouldWarnReopenRollback("round_1", {
        task_type: "form",
        is_required: 0,
      }),
    ).toBe(false);
  });
});

describe("ReopenTaskDialog", () => {
  const base = {
    open: true,
    task: {
      title_en: "ID Front",
      slug: "id_front",
      task_type: "upload",
      is_required: 1,
    },
    pipelineStage: "new_client" as string | null,
    notifyClient: false,
    reason: "",
    sending: false,
    onOpenChange: vi.fn(),
    onNotifyChange: vi.fn(),
    onReasonChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders task copy and keeps notify off by default", () => {
    renderWithProviders(<ReopenTaskDialog {...base} />);
    expect(screen.getByText(/ID Front/i)).toBeInTheDocument();
    expect(screen.getByTestId("reopen-notify-client")).not.toBeChecked();
    expect(screen.queryByTestId("reopen-rollback-hint")).toBeNull();
  });

  it("shows rollback hint mid-pipeline", () => {
    renderWithProviders(
      <ReopenTaskDialog {...base} pipelineStage="round_1" />,
    );
    expect(screen.getByTestId("reopen-rollback-hint")).toBeInTheDocument();
  });

  it("toggles notify and confirms", async () => {
    const user = userEvent.setup();
    const onNotifyChange = vi.fn();
    const onConfirm = vi.fn();
    const onReasonChange = vi.fn();
    renderWithProviders(
      <ReopenTaskDialog
        {...base}
        onNotifyChange={onNotifyChange}
        onConfirm={onConfirm}
        onReasonChange={onReasonChange}
      />,
    );

    await user.click(screen.getByTestId("reopen-notify-client"));
    expect(onNotifyChange).toHaveBeenCalledWith(true);

    await user.type(screen.getByLabelText(/Note \(optional\)/i), "Need clearer scan");
    expect(onReasonChange).toHaveBeenCalled();

    await user.click(screen.getByTestId("reopen-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<ReopenTaskDialog {...base} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
