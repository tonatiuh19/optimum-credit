import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ClientSearchPicker } from "@/components/ui/client-search-picker";
import type { AdminClientListItem } from "@shared/api";

const searchClientsMock = vi.fn();

vi.mock("@/store/slices/adminSlice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/slices/adminSlice")>();
  const thunk = Object.assign(
    (args: unknown) => {
      searchClientsMock(args);
      return {
        type: "admin/clients/search/fulfilled",
        payload: [],
        meta: { requestId: "t", arg: args },
      };
    },
    {
      pending: { type: "admin/clients/search/pending" },
      fulfilled: { type: "admin/clients/search/fulfilled" },
      rejected: { type: "admin/clients/search/rejected" },
      typePrefix: "admin/clients/search",
    },
  );
  return { ...actual, searchClients: thunk };
});

function makeClient(
  partial: Partial<AdminClientListItem> & Pick<AdminClientListItem, "id" | "status">,
): AdminClientListItem {
  return {
    first_name: "Test",
    last_name: "User",
    email: `u${partial.id}@example.test`,
    pipeline_stage: partial.status === "prospect" ? "prospect" : "new_client",
    created_at: new Date().toISOString(),
    ...partial,
  } as AdminClientListItem;
}

const prospect = makeClient({
  id: 1,
  first_name: "Pros",
  last_name: "Pect",
  status: "prospect",
});
const ghostLead = makeClient({
  id: 3,
  first_name: "Ghost",
  last_name: "Lead",
  status: "pending_payment",
  pipeline_stage: "prospect",
});
const client = makeClient({
  id: 2,
  first_name: "Real",
  last_name: "Client",
  status: "active",
});

function renderPicker(props: {
  excludeProspects?: boolean;
  prospectsOnly?: boolean;
  results?: AdminClientListItem[];
}) {
  const store = configureStore({
    reducer: {
      admin: () => ({
        clientSearchResults: props.results ?? [prospect, client],
        clientSearchLoading: false,
      }),
    },
  });
  const onChange = vi.fn();
  renderWithProviders(
    <Provider store={store}>
      <ClientSearchPicker
        value={null}
        onChange={onChange}
        excludeProspects={props.excludeProspects}
        prospectsOnly={props.prospectsOnly}
        placeholder="Search…"
      />
    </Provider>,
  );
  return { onChange };
}

describe("ClientSearchPicker prospect filters", () => {
  beforeEach(() => {
    searchClientsMock.mockClear();
  });

  it("prospectsOnly dispatches search for unconverted leads", async () => {
    const user = userEvent.setup();
    renderPicker({ prospectsOnly: true, results: [prospect] });
    await user.type(screen.getByPlaceholderText("Search…"), "pros");
    await waitFor(
      () => {
        expect(searchClientsMock).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const calls = searchClientsMock.mock.calls;
    const last = calls[calls.length - 1]?.[0];
    expect(last).toEqual({ query: "pros", unconvertedLead: true });
  });

  it("prospectsOnly only lists prospects in results", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      prospectsOnly: true,
      results: [prospect, client],
    });
    const input = screen.getByPlaceholderText("Search…");
    await user.click(input);
    await user.type(input, "p");
    await waitFor(() => {
      expect(screen.getByText(/Pros Pect/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Real Client/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/Pros Pect/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: "prospect" }),
    );
  });

  it("prospectsOnly lists pending_payment leads still on prospect stage", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      prospectsOnly: true,
      results: [ghostLead, client],
    });
    const input = screen.getByPlaceholderText("Search…");
    await user.click(input);
    await user.type(input, "g");
    await waitFor(() => {
      expect(screen.getByText(/Ghost Lead/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Real Client/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/Ghost Lead/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, status: "pending_payment" }),
    );
  });

  it("excludeProspects hides prospects from results", async () => {
    const user = userEvent.setup();
    renderPicker({
      excludeProspects: true,
      results: [prospect, client],
    });
    const input = screen.getByPlaceholderText("Search…");
    await user.click(input);
    await user.type(input, "r");
    await waitFor(() => {
      expect(screen.getByText(/Real Client/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Pros Pect/i)).not.toBeInTheDocument();
  });
});
