import { describe, expect, it } from "vitest";
import {
  ADMIN_CLIENTS_EXPORT_MAX_ROWS,
  buildAdminClientsExportCsv,
  clientsExportFilename,
  csvEscapeCell,
} from "./clientsExport";

describe("clientsExport", () => {
  it("escapes CSV cells", () => {
    expect(csvEscapeCell('a,b')).toBe('"a,b"');
    expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscapeCell(null)).toBe("");
  });

  it("builds name + status + stage + contact columns", () => {
    const csv = buildAdminClientsExportCsv([
      {
        id: 9,
        first_name: "Ana",
        last_name: "Lopez",
        status: "active",
        pipeline_stage: "new_client",
        email: "ana@example.test",
        phone: "+15551234567",
        created_at: "2026-10-01T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain(
      "client_id,first_name,last_name,name,status,pipeline_stage,email,phone,created_at",
    );
    expect(csv).toContain("9,Ana,Lopez,Ana Lopez,active,new_client,ana@example.test,+15551234567,2026-10-01");
    expect(ADMIN_CLIENTS_EXPORT_MAX_ROWS).toBeGreaterThan(1000);
  });

  it("names file ofg-clients-YYYY-MM-DD.csv", () => {
    expect(clientsExportFilename(new Date("2026-10-01T15:00:00Z"))).toBe(
      "ofg-clients-2026-10-01.csv",
    );
  });
});
