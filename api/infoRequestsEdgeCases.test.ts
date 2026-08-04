/**
 * Edge-case and gap-hunting tests for Client Info Requests.
 * Covers presets, consent, status transitions, field partitioning,
 * sensitive data handling, and create-payload validation.
 */
import { describe, expect, it } from "vitest";
import type { InfoRequestFieldDef } from "../shared/api";
import {
  buildInfoRequestPresetFields,
  defaultInfoRequestTitles,
  isSensitiveFieldType,
} from "../shared/infoRequestPresets";
import {
  canAdminCancelInfoRequest,
  canAdminReviewInfoRequest,
  canClientSubmitInfoRequest,
  countsTowardPipelineSoftWarn,
  isInfoRequestActionable,
  localizeInfoRequestCopy,
  normalizeCardLast4,
  parseInfoFieldsJson,
  parseInfoResponseJson,
  partitionInfoRequestResponses,
  validateBillingConfirm,
  validateCreateInfoRequestPayload,
  validateInfoRequestConsent,
  validateSmartCreditBlock,
} from "./index";

const textField = (
  overrides: Partial<InfoRequestFieldDef> = {},
): InfoRequestFieldDef => ({
  id: "notes",
  key: "notes",
  type: "text",
  label_en: "Notes",
  label_es: "Notas",
  required: true,
  ...overrides,
});

// ── Presets ──────────────────────────────────────────────────────────────────

describe("info request presets", () => {
  it("builds Smart Credit block as required sensitive field", () => {
    const fields = buildInfoRequestPresetFields("smart_credit");
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe("smart_credit_block");
    expect(fields[0].required).toBe(true);
    expect(isSensitiveFieldType(fields[0].type)).toBe(true);
  });

  it("builds payment_card and payment_billing presets distinctly", () => {
    expect(buildInfoRequestPresetFields("payment_card")[0].type).toBe(
      "payment_card",
    );
    expect(buildInfoRequestPresetFields("payment_billing")[0].type).toBe(
      "billing_confirm",
    );
  });

  it("custom preset includes optional upload", () => {
    const fields = buildInfoRequestPresetFields("custom");
    expect(fields.some((f) => f.type === "textarea" && f.required)).toBe(true);
    expect(fields.some((f) => f.type === "upload" && !f.required)).toBe(true);
  });

  it("titles are bilingual and non-empty for every preset", () => {
    for (const key of [
      "smart_credit",
      "payment_card",
      "payment_billing",
      "custom",
    ] as const) {
      const t = defaultInfoRequestTitles(key);
      expect(t.title_en.trim().length).toBeGreaterThan(0);
      expect(t.title_es.trim().length).toBeGreaterThan(0);
      expect(t.message_en.trim().length).toBeGreaterThan(0);
      expect(t.message_es.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── Status transitions ───────────────────────────────────────────────────────

describe("info request status transitions", () => {
  it("client can only submit open or rejected", () => {
    expect(canClientSubmitInfoRequest("open")).toBe(true);
    expect(canClientSubmitInfoRequest("rejected")).toBe(true);
    expect(canClientSubmitInfoRequest("submitted")).toBe(false);
    expect(canClientSubmitInfoRequest("approved")).toBe(false);
    expect(canClientSubmitInfoRequest("cancelled")).toBe(false);
  });

  it("admin can only review submitted", () => {
    expect(canAdminReviewInfoRequest("submitted")).toBe(true);
    expect(canAdminReviewInfoRequest("open")).toBe(false);
    expect(canAdminReviewInfoRequest("approved")).toBe(false);
  });

  it("admin cannot cancel approved or cancelled", () => {
    expect(canAdminCancelInfoRequest("open")).toBe(true);
    expect(canAdminCancelInfoRequest("submitted")).toBe(true);
    expect(canAdminCancelInfoRequest("rejected")).toBe(true);
    expect(canAdminCancelInfoRequest("approved")).toBe(false);
    expect(canAdminCancelInfoRequest("cancelled")).toBe(false);
  });

  it("banner actionable = open + rejected only", () => {
    expect(isInfoRequestActionable("open")).toBe(true);
    expect(isInfoRequestActionable("rejected")).toBe(true);
    expect(isInfoRequestActionable("submitted")).toBe(false);
    expect(isInfoRequestActionable("approved")).toBe(false);
  });

  it("pipeline soft-warn includes submitted (staff still needs to act)", () => {
    expect(countsTowardPipelineSoftWarn("open")).toBe(true);
    expect(countsTowardPipelineSoftWarn("submitted")).toBe(true);
    expect(countsTowardPipelineSoftWarn("rejected")).toBe(true);
    expect(countsTowardPipelineSoftWarn("approved")).toBe(false);
    expect(countsTowardPipelineSoftWarn("cancelled")).toBe(false);
  });
});

// ── Consent ──────────────────────────────────────────────────────────────────

describe("info request consent", () => {
  it("requires both Terms and SMS checkboxes", () => {
    expect(validateInfoRequestConsent(false, false)?.code).toBe(
      "consent_required",
    );
    expect(validateInfoRequestConsent(true, false)?.code).toBe(
      "consent_required",
    );
    expect(validateInfoRequestConsent(false, true)?.code).toBe(
      "consent_required",
    );
    expect(validateInfoRequestConsent(true, true)).toBeNull();
  });
});

// ── JSON parsing edge cases ──────────────────────────────────────────────────

describe("info request JSON parsing", () => {
  it("parses fields from array, JSON string, or garbage", () => {
    expect(parseInfoFieldsJson([{ key: "a", type: "text" }])).toHaveLength(1);
    expect(
      parseInfoFieldsJson(JSON.stringify([{ key: "a", type: "text" }])),
    ).toHaveLength(1);
    expect(parseInfoFieldsJson("not-json")).toEqual([]);
    expect(parseInfoFieldsJson(null)).toEqual([]);
    expect(parseInfoFieldsJson({ key: "nope" })).toEqual([]);
  });

  it("parses response JSON safely", () => {
    expect(parseInfoResponseJson({ a: 1 })).toEqual({ a: 1 });
    expect(parseInfoResponseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseInfoResponseJson("bad")).toBeNull();
    expect(parseInfoResponseJson(null)).toBeNull();
    expect(parseInfoResponseJson([1, 2])).toBeNull();
  });
});

// ── Field validation / partition ─────────────────────────────────────────────

describe("partitionInfoRequestResponses — edge cases", () => {
  it("rejects missing required text", () => {
    const result = partitionInfoRequestResponses([textField()], {});
    expect(result.errors.some((e) => e.code === "required")).toBe(true);
  });

  it("keeps passwords out of safeResponses", () => {
    const result = partitionInfoRequestResponses(
      [
        textField({
          id: "pw",
          key: "pw",
          type: "password",
          required: true,
        }),
      ],
      { pw: "hunter2" },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.secrets.pw).toBe("hunter2");
    expect(result.safeResponses.pw).toEqual({ received: true });
    expect(JSON.stringify(result.safeResponses)).not.toContain("hunter2");
  });

  it("encrypts Smart Credit secrets and never puts password in safe JSON", () => {
    const fields = buildInfoRequestPresetFields("smart_credit");
    const result = partitionInfoRequestResponses(fields, {
      smart_credit: {
        email: "alex@example.com",
        password: "fixture-smartcredit-pw",
        security_question: "Pet name?",
        security_answer: "Mochi",
      },
    });
    expect(result.errors).toHaveLength(0);
    expect(result.secrets.smart_credit).toMatchObject({
      email: "alex@example.com",
      password: "fixture-smartcredit-pw",
      security_answer: "Mochi",
    });
    expect(result.safeResponses.smart_credit).toEqual({
      email: "alex@example.com",
      credentials_received: true,
    });
    expect(JSON.stringify(result.safeResponses)).not.toContain(
      "fixture-smartcredit-pw",
    );
    expect(JSON.stringify(result.safeResponses)).not.toContain("Mochi");
  });

  it("rejects incomplete Smart Credit block", () => {
    const fields = buildInfoRequestPresetFields("smart_credit");
    const result = partitionInfoRequestResponses(fields, {
      smart_credit: { email: "alex@example.com", password: "x" },
    });
    expect(result.errors[0]?.code).toBe("smart_credit_incomplete");
  });

  it("rejects invalid Smart Credit email", () => {
    expect(
      validateSmartCreditBlock(
        {
          email: "not-an-email",
          password: "x",
          security_question: "q",
          security_answer: "a",
        },
        true,
      )?.code,
    ).toBe("smart_credit_email_invalid");
  });

  it("normalizes card last4 and rejects short values", () => {
    expect(normalizeCardLast4("12-34")).toBe("1234");
    expect(normalizeCardLast4("****1234")).toBe("1234");
    expect(normalizeCardLast4("12")).toBe("12");
    expect(
      validateBillingConfirm(
        {
          address_line1: "1 Main",
          city: "Austin",
          state: "TX",
          postal_code: "78701",
          card_last4: "12",
        },
        true,
      )?.code,
    ).toBe("billing_incomplete");
  });

  it("partitions billing confirm without secrets", () => {
    const fields = buildInfoRequestPresetFields("payment_billing");
    const result = partitionInfoRequestResponses(fields, {
      billing_confirm: {
        address_line1: "1 Main St",
        address_line2: "",
        city: "Austin",
        state: "TX",
        postal_code: "78701",
        card_last4: "4242",
      },
    });
    expect(result.errors).toHaveLength(0);
    expect(result.secrets).toEqual({});
    expect(result.safeResponses.billing_confirm).toMatchObject({
      card_last4: "4242",
      city: "Austin",
    });
  });

  it("requires Accept.js opaque data for payment_card", () => {
    const fields = buildInfoRequestPresetFields("payment_card");
    const missing = partitionInfoRequestResponses(fields, {});
    expect(missing.errors[0]?.code).toBe("card_required");
    expect(missing.requiresPaymentOpaque).toBe(true);

    const ok = partitionInfoRequestResponses(fields, {}, {
      hasPaymentOpaque: true,
    });
    expect(ok.errors).toHaveLength(0);
    expect(ok.safeResponses.payment_card).toEqual({ card_updated: true });
  });

  it("requires upload file for required upload fields", () => {
    const fields: InfoRequestFieldDef[] = [
      textField({
        id: "id_scan",
        key: "id_scan",
        type: "upload",
        required: true,
      }),
    ];
    const missing = partitionInfoRequestResponses(fields, {});
    expect(missing.errors[0]?.code).toBe("file_required");

    const ok = partitionInfoRequestResponses(fields, {}, {
      uploadedFieldKeys: new Set(["id_scan"]),
    });
    expect(ok.errors).toHaveLength(0);
  });

  it("allows optional upload / optional fields to be empty", () => {
    const fields = buildInfoRequestPresetFields("custom");
    const result = partitionInfoRequestResponses(fields, {
      notes: "Here is my update",
    });
    expect(result.errors).toHaveLength(0);
    expect(result.safeResponses.notes).toBe("Here is my update");
  });

  it("flags empty field keys in definitions", () => {
    const result = partitionInfoRequestResponses(
      [textField({ id: "x", key: "" })],
      {},
    );
    expect(result.errors.some((e) => e.code === "field_key_missing")).toBe(
      true,
    );
  });

  it("never leaks password into safeResponses for mixed forms", () => {
    const fields: InfoRequestFieldDef[] = [
      textField({ key: "notes", id: "notes", type: "textarea" }),
      textField({
        key: "portal_password",
        id: "portal_password",
        type: "password",
        required: true,
      }),
    ];
    const result = partitionInfoRequestResponses(fields, {
      notes: "hello",
      portal_password: "fixture-portal-pw",
    });
    expect(JSON.stringify(result.safeResponses)).not.toContain(
      "fixture-portal-pw",
    );
    expect(result.secrets.portal_password).toBe("fixture-portal-pw");
  });
});

// ── Create payload ───────────────────────────────────────────────────────────

describe("validateCreateInfoRequestPayload", () => {
  it("requires bilingual titles and non-empty fields", () => {
    expect(
      validateCreateInfoRequestPayload({
        title_en: "",
        title_es: "x",
        fields_json: [textField()],
      })?.code,
    ).toBe("titles_required");
    expect(
      validateCreateInfoRequestPayload({
        title_en: "x",
        title_es: "y",
        fields_json: [],
      })?.code,
    ).toBe("fields_required");
  });

  it("rejects duplicate field keys (gap that would break submit)", () => {
    expect(
      validateCreateInfoRequestPayload({
        title_en: "A",
        title_es: "B",
        fields_json: [
          textField({ key: "same", id: "1" }),
          textField({ key: "same", id: "2", type: "textarea" }),
        ],
      })?.code,
    ).toBe("duplicate_field_key");
  });

  it("accepts valid free-form create payload", () => {
    expect(
      validateCreateInfoRequestPayload({
        title_en: "Need docs",
        title_es: "Necesitamos docs",
        fields_json: buildInfoRequestPresetFields("custom"),
      }),
    ).toBeNull();
  });
});

// ── Localization ─────────────────────────────────────────────────────────────

describe("localizeInfoRequestCopy", () => {
  it("picks EN/ES with optional message overrides", () => {
    const row = {
      title_en: "Update card",
      title_es: "Actualizar tarjeta",
      message_en: "Please update",
      message_es: "Por favor actualiza",
    };
    expect(localizeInfoRequestCopy(row, "en").title).toBe("Update card");
    expect(localizeInfoRequestCopy(row, "es").title).toBe(
      "Actualizar tarjeta",
    );
    expect(localizeInfoRequestCopy({ ...row, message_es: null }, "es").message)
      .toBeNull();
  });
});
