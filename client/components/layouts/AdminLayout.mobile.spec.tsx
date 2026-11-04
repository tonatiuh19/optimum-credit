/**
 * Phone shell (Groundwork-style): bottom tab bar with 4 sections + More,
 * More opens the menu as a bottom sheet; Esc / route change closes it.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/api", async (orig) => {
  const real: any = await orig();
  const pending = () => new Promise(() => {});
  return {
    ...real,
    getAdminToken: () => "test-token",
    default: { get: pending, post: pending, put: pending, patch: pending, delete: pending, interceptors: real.default.interceptors },
  };
});

import { renderWithProviders } from "@/test/renderWithProviders";
import { store } from "@/store";
import { fetchAdminMe } from "@/store/slices/adminAuthSlice";
import { fetchSectionLocks } from "@/store/slices/adminSlice";
import AdminLayout from "@/components/layouts/AdminLayout";

function setup() {
  act(() => {
    store.dispatch({
      type: fetchAdminMe.fulfilled.type,
      payload: { user: { id: 30001, first_name: "Alex", last_name: "Gomez", email: "a@x.com", role: "super_admin", conversations_enabled: true } },
    });
    store.dispatch({ type: fetchSectionLocks.fulfilled.type, payload: [] });
  });
  return renderWithProviders(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin"]}>
        <AdminLayout>
          <p>page</p>
        </AdminLayout>
      </MemoryRouter>
    </Provider>,
  );
}

describe("AdminLayout — phone shell", () => {
  it("bottom tab bar: Dashboard, Pipeline, Conversations, My tasks + More", () => {
    setup();
    const bar = screen.getByTestId("admin-tabbar");
    const links = Array.from(bar.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/admin", "/admin/pipeline", "/admin/conversations", "/admin/my-tasks"]);
    expect(screen.getByTestId("admin-tabbar-more")).toBeTruthy();
  });

  it("More opens the menu sheet; Esc closes it", () => {
    setup();
    const sheet = document.getElementById("admin-nav-sheet")!;
    const open = () => sheet.className.split(/\s+/).includes("translate-y-0");
    expect(open()).toBe(false);
    fireEvent.click(screen.getByTestId("admin-tabbar-more"));
    expect(screen.getByTestId("admin-tabbar-more").getAttribute("aria-expanded")).toBe("true");
    expect(open()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(open()).toBe(false);
  });
});
