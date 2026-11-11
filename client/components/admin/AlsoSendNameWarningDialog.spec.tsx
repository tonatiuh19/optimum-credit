import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => apiPost(...a) } };
});
import { Provider } from "react-redux";
import type { ReactElement } from "react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AlsoSendNameWarningDialog } from "@/components/admin/AlsoSendNameWarningDialog";
import { ConversationComposeAlsoSend } from "@/components/admin/ConversationComposeAlsoSend";
import type { ClientReferrerLink } from "@shared/api";

const { store } = await import("@/store");
const renderWithStore = (ui: ReactElement) => renderWithProviders(<Provider store={store}>{ui}</Provider>);

const recipients = [
  { key: "ref-1", phone: "+15550001111", label: "Marco", phoneClientName: "Velia Zurita" },
  { key: "phone-2", phone: "+15550002222", label: "+15550002222" },
];

describe("AlsoSendNameWarningDialog", () => {
  it("lists every copy recipient, flags a shared phone, and confirms or cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <AlsoSendNameWarningDialog
        warning={{ clientName: "Carlos", recipients }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const list = screen.getByTestId("also-name-warning-recipients");
    expect(list.textContent).toContain("Marco");
    expect(list.textContent).toContain("+15550002222");
    expect(list.textContent).toContain("Velia Zurita");
    expect(document.body.textContent).toContain("Carlos");
    fireEvent.click(screen.getByTestId("also-name-warning-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel does not send", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <AlsoSendNameWarningDialog warning={{ clientName: "", recipients }} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("also-name-warning-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no warning", () => {
    renderWithProviders(<AlsoSendNameWarningDialog warning={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByTestId("also-name-warning-recipients")).toBeNull();
  });
});

describe("ConversationComposeAlsoSend shared phone label", () => {
  const target = { kind: "client", client: { id: 1, first_name: "Carlos", last_name: "Jr", phone: "+15559990000" } } as any;
  const link = (id: number, first: string, phone: string, phone_client: ClientReferrerLink["phone_client"]): ClientReferrerLink => ({
    id, client_id: 1, referrer_id: id, role: "primary", sort_order: 0, notify_on_round: true,
    referrer: { id, first_name: first, last_name: "", phone } as any, phone_client,
  });

  it("shows the other client's name only for a shared phone, and carries it into the selection", () => {
    const onChange = vi.fn();
    renderWithStore(
      <ConversationComposeAlsoSend
        composeTarget={target}
        referrers={[
          link(1, "Marco", "+15550001111", { id: 9, first_name: "Velia", last_name: "Zurita" }),
          link(2, "Ana", "+15550003333", null),
        ]}
        selected={[]}
        onChange={onChange}
        defaultExpanded
      />,
    );
    const flags = screen.getAllByTestId("compose-also-shared-phone");
    expect(flags).toHaveLength(1);
    expect(flags[0].textContent).toContain("Velia Zurita");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ label: "Marco", phoneClientName: "Velia Zurita" }),
    ]);
  });

  it("a typed number that belongs to another client is flagged; lookup errors still add it", async () => {
    apiPost.mockResolvedValueOnce({ data: { client: { id: 9, first_name: "Velia", last_name: "Zurita" } } });
    const onChange = vi.fn();
    renderWithStore(
      <ConversationComposeAlsoSend composeTarget={target} referrers={[]} selected={[]} onChange={onChange} defaultExpanded />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "+1 555 000 1111" } });
    fireEvent.click(screen.getByTestId("compose-also-add-phone"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith("/admin/conversations/phone-owner", expect.objectContaining({ client_id: 1 }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ phoneClientName: "Velia Zurita" });

    apiPost.mockRejectedValueOnce(new Error("network"));
    onChange.mockClear();
    fireEvent.change(input, { target: { value: "+1 555 000 2222" } });
    fireEvent.click(screen.getByTestId("compose-also-add-phone"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0].phoneClientName).toBeUndefined();
  });

  it("selected chips mark a shared phone", () => {
    renderWithStore(
      <ConversationComposeAlsoSend
        composeTarget={target}
        referrers={[]}
        selected={[{ key: "phone-1", phone: "+15550001111", label: "+15550001111", phoneClientName: "Velia Zurita" }]}
        onChange={vi.fn()}
        defaultExpanded
      />,
    );
    expect(screen.getByTestId("compose-also-chip-shared").getAttribute("title")).toContain("Velia Zurita");
  });
});
