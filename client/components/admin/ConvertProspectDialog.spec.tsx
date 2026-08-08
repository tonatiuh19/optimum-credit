import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderWithProviders } from "@/test/renderWithProviders";
import ConvertProspectDialog from "@/components/admin/ConvertProspectDialog";
import {
  buildConvertProspectBody,
  emptyProspectConvertFormValues,
} from "@/components/admin/ProspectConvertFields";
import type { Prospect } from "@shared/api";

const fetchCaseRoundScheduleMock = vi.fn();

vi.mock("@/store/slices/adminSlice", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/store/slices/adminSlice")>();
  const thunk = Object.assign(
    (caseId: number) => {
      fetchCaseRoundScheduleMock(caseId);
      return {
        type: "admin/fetchCaseRoundSchedule/fulfilled",
        payload: {
          case_id: caseId,
          round_1_date: "2026-09-01",
          round_2_date: "2026-10-06",
          round_3_date: "2026-11-10",
          round_4_date: "2026-12-15",
          round_5_date: "2027-01-19",
          interval_days: 35,
          calendar_uid_ns: "ns",
          last_sent_at: null,
          last_sent_recipients: null,
          updated_at: "2026-01-01T00:00:00Z",
        },
        meta: { requestId: "t", arg: caseId },
      };
    },
    {
      pending: { type: "admin/fetchCaseRoundSchedule/pending" },
      fulfilled: {
        type: "admin/fetchCaseRoundSchedule/fulfilled",
        match: (a: { type?: string }) =>
          a?.type === "admin/fetchCaseRoundSchedule/fulfilled",
      },
      rejected: { type: "admin/fetchCaseRoundSchedule/rejected" },
      typePrefix: "admin/fetchCaseRoundSchedule",
    },
  );
  return { ...actual, fetchCaseRoundSchedule: thunk };
});

const prospect: Prospect = {
  id: 42,
  first_name: "Pat",
  last_name: "Lead",
  email: "pat@example.test",
  preferred_language: "en",
  created_at: new Date().toISOString(),
};

function renderDialog(
  ui: ReactElement,
  packages: { id: number; name: string }[] = [{ id: 7, name: "Standard" }],
) {
  const store = configureStore({
    reducer: {
      packages: () => ({ packages, loading: false }),
    },
  });
  return renderWithProviders(<Provider store={store}>{ui}</Provider>);
}

describe("buildConvertProspectBody", () => {
  it("maps empty package and trims notes", () => {
    const body = buildConvertProspectBody({
      ...emptyProspectConvertFormValues(),
      packageId: "__none__",
      notes: "  hello  ",
    });
    expect(body.package_id).toBeNull();
    expect(body.notes).toBe("hello");
    expect(body.round_schedule.send_calendar).toBe(false);
  });

  it("parses package id and includes round schedule send flag", () => {
    const values = emptyProspectConvertFormValues();
    values.packageId = "7";
    values.roundSchedule = {
      ...values.roundSchedule,
      send_calendar: true,
    };
    const body = buildConvertProspectBody(values);
    expect(body.package_id).toBe(7);
    expect(body.round_schedule.send_calendar).toBe(true);
  });
});

describe("ConvertProspectDialog", () => {
  beforeEach(() => {
    fetchCaseRoundScheduleMock.mockClear();
  });

  it("submits convert payload with package, notes, and round schedule", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn().mockResolvedValue(undefined);
    const onConverted = vi.fn();
    const onClose = vi.fn();

    renderDialog(
      <ConvertProspectDialog
        prospect={prospect}
        onClose={onClose}
        onConverted={onConverted}
        onConvert={onConvert}
      />,
    );

    expect(screen.getByTestId("convert-prospect-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("prospect-convert-fields")).toBeInTheDocument();
    expect(screen.getByTestId("prospect-convert-target")).toBeInTheDocument();

    await user.type(
      screen.getByTestId("prospect-convert-notes"),
      "Ready to start",
    );

    await user.click(screen.getByTestId("send-round-calendar"));
    await user.click(screen.getByTestId("convert-prospect-confirm"));

    expect(onConvert).toHaveBeenCalledTimes(1);
    const payload = onConvert.mock.calls[0][0];
    expect(payload.id).toBe(42);
    expect(payload.notes).toBe("Ready to start");
    expect(payload.round_schedule?.send_calendar).toBe(true);
    expect(payload.round_schedule?.round_1_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onConverted).toHaveBeenCalled();
  });

  it("prefills round schedule when prospect has case_id", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn().mockResolvedValue(undefined);
    renderDialog(
      <ConvertProspectDialog
        prospect={{ ...prospect, case_id: 55 }}
        onClose={vi.fn()}
        onConverted={vi.fn()}
        onConvert={onConvert}
      />,
    );

    await waitFor(() => {
      expect(fetchCaseRoundScheduleMock).toHaveBeenCalledWith(55);
    });
    await waitFor(() => {
      expect(screen.getByTestId("prospect-convert-fields")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("convert-prospect-confirm"));
    const payload = onConvert.mock.calls[0][0];
    expect(payload.round_schedule?.round_1_date).toBe("2026-09-01");
    expect(payload.round_schedule?.interval_days).toBe(35);
    expect(payload.round_schedule?.send_calendar).toBe(false);
  });

  it("cancels without converting", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    const onClose = vi.fn();
    renderDialog(
      <ConvertProspectDialog
        prospect={prospect}
        onClose={onClose}
        onConverted={vi.fn()}
        onConvert={onConvert}
      />,
    );
    await user.click(screen.getByTestId("convert-prospect-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onConvert).not.toHaveBeenCalled();
  });
});
