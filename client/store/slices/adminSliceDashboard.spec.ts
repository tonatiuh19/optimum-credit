import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import admin, { fetchAdminDashboard } from "@/store/slices/adminSlice";
describe("adminSlice dashboard (reducer builds; no duplicate addCase for admin/dashboard)", () => {
  it("builds the reducer and tracks dashboard refresh", () => {
    const store = configureStore({ reducer: { admin } });
    store.dispatch({ type: fetchAdminDashboard.pending.type });
    expect(store.getState().admin.dashboardRefreshing).toBe(true);
    store.dispatch({ type: fetchAdminDashboard.rejected.type, error: {} });
    expect(store.getState().admin.dashboardRefreshing).toBe(false);
    store.dispatch({ type: fetchAdminDashboard.fulfilled.type, payload: { stages: [], stats: {}, recent_clients: [], recent_tickets: [], recent_payments: [] } });
    expect(store.getState().admin.dashboardLoaded).toBe(true);
  });
});
