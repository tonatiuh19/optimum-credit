import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ClientPanelSheet } from "@/components/admin/ClientPanelSheet";
import type { Prospect } from "@shared/api";

vi.mock("@/store/slices/adminSlice", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/store/slices/adminSlice")>();
  const passthrough = (type: string) =>
    Object.assign((arg: unknown) => ({ type, payload: null, meta: { arg } }), {
      pending: { type: `${type}/pending` },
      fulfilled: { type: `${type}/fulfilled` },
      rejected: { type: `${type}/rejected` },
      typePrefix: type,
    });
  return {
    ...actual,
    fetchPanelClient: passthrough("admin/panelClient"),
    fetchPanelCase: passthrough("admin/fetchPanelCase"),
    fetchCaseDocuments: passthrough("admin/fetchCaseDocuments"),
    clearPanelClient: () => ({ type: "admin/clearPanelClient" }),
  };
});

vi.mock("@/store/slices/adminTasksSlice", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/store/slices/adminTasksSlice")>();
  const passthrough = (type: string) =>
    Object.assign((arg: unknown) => ({ type, payload: null, meta: { arg } }), {
      pending: { type: `${type}/pending` },
      fulfilled: { type: `${type}/fulfilled` },
      rejected: { type: `${type}/rejected` },
      typePrefix: type,
    });
  return {
    ...actual,
    fetchClientTaskCompletions: passthrough("tasks/client"),
    fetchCaseTaskCompletions: passthrough("tasks/case"),
  };
});

function renderProspectPanel(opts: {
  caseId?: number | null;
  onConvert?: (prospect: Prospect) => void;
}) {
  const onConvertProspect = vi.fn<(prospect: Prospect) => void>();
  if (opts.onConvert) onConvertProspect.mockImplementation(opts.onConvert);
  const store = configureStore({
    reducer: {
      admin: () => ({
        panelClient: {
          client: {
            id: 99,
            first_name: "Pat",
            last_name: "Lead",
            email: "pat@example.test",
            status: "prospect",
            pipeline_stage: "prospect",
            created_at: "2026-01-01T00:00:00Z",
            preferred_language: "en",
          },
          case_info: opts.caseId
            ? {
                id: opts.caseId,
                case_number: "CR-00099",
                status: "active",
                pipeline_stage: "prospect",
              }
            : undefined,
          documents: [],
          reports: [],
          payments: [],
          pipeline_history: [],
        },
        panelLoading: false,
        caseDocuments: [],
        caseDocumentsLoading: false,
      }),
      adminTasks: () => ({
        clientCompletions: {},
        caseCompletions: {},
        caseCompletionsLoading: false,
        clientCompletionsLoading: false,
        saving: false,
      }),
      prospects: () => ({ labels: [] }),
    },
  });

  renderWithProviders(
    <Provider store={store}>
      <ClientPanelSheet
        open
        caseId={opts.caseId ?? null}
        clientId={99}
        onClose={vi.fn()}
        onCaseUpdated={vi.fn()}
        onConvertProspect={onConvertProspect}
      />
    </Provider>,
  );
  return { onConvertProspect };
}

describe("ClientPanelSheet prospect empty state + convert CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows prospect banner and convert CTA without a case", async () => {
    const user = userEvent.setup();
    const { onConvertProspect } = renderProspectPanel({});

    expect(
      await screen.findByTestId("panel-prospect-banner"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("panel-prospect-badge")).toBeInTheDocument();

    await user.click(screen.getByTestId("panel-prospect-convert"));
    expect(onConvertProspect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 99,
        email: "pat@example.test",
        case_id: null,
      }),
    );
  });

  it("shows tasks empty state for prospects with convert CTA", async () => {
    const user = userEvent.setup();
    renderProspectPanel({});

    await user.click(screen.getByRole("button", { name: /tasks/i }));
    expect(
      await screen.findByTestId("panel-prospect-tasks-empty"),
    ).toBeInTheDocument();
  });

  it("passes case_id when prospect has a prospect-stage case", async () => {
    const user = userEvent.setup();
    const { onConvertProspect } = renderProspectPanel({ caseId: 55 });

    await waitFor(() => {
      expect(screen.getByTestId("panel-prospect-banner")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("panel-prospect-convert"));
    expect(onConvertProspect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, case_id: 55 }),
    );
  });
});
