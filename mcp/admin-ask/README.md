# Optimum Admin Ask — Remote MCP (OAuth)

**Preferred:** Claude (and Cursor) connect to:

```text
https://www.ofgllc.com/api/mcp
```

No shared master token. Each admin signs in, consents, and can revoke in **My profile → Connected AI apps**.

## Claude setup (primary)

Remote MCP is added as a **custom connector** (not `claude_desktop_config.json` — that file is stdio-only).

1. Deploy API with `ADMIN_AI_ENABLED=1`
2. In Claude (web or Desktop): **Customize → Connectors → Add custom connector**
3. Name: `Optimum Admin Ask`
4. URL: `https://www.ofgllc.com/api/mcp`
5. Connect → browser opens Optimum → log in as **admin/super_admin** → **Allow access**
6. Tools appear under your admin identity

Help: [Custom connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

OAuth callbacks we allow for Claude:

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`
- Claude Code loopback: `http://localhost/callback` / `http://127.0.0.1/callback` (any port)

### Read tools

| Tool | Chat example |
|---|---|
| `list_clients_owing` | “Which clients owe money / are overdue?” |
| `list_installments` | “Show installments for case CR-…” |
| `list_payments` | “Payment history for Jane” |
| `get_client` / `list_case_documents` | Profile + `referrers[]` + `funding_applications[]` (dual CR+funding) + docs status |
| `search_clients` | CR clients **and** `funding_applications` (funding-only intakes) |
| `list_funding_applications` / `get_funding_application` | Funding board search + one app + docs uploaded |
| `funding_pipeline_summary` | Funding column counts (use instead of CR `pipeline_summary`) |
| `list_round_schedule` | Round calendar dates |
| (+ existing search/pipeline/reports/tasks) | |

Each tool advertises its own JSON Schema over MCP (not a shared stub). MCP sets `readOnlyHint: true` so Claude dry-runs are not blocked by UI approval; **writes still require** `confirm=true` + `confirm_phrase: "CONFIRM"` in the tool args (API-enforced).

### Write tools (guided — dry-run then confirm)

Claude must collect fields, call with `confirm=false` (preview), show the user, then `confirm=true` + `confirm_phrase: "CONFIRM"`.

| Tool | Required / notes |
|---|---|
| `create_prospect` | first/last/phone/`preferred_language`; realtor → `referral_category=realtor_broker` + referrer name/phone/email; phone dup check |
| `create_work_task` | title + `preferred_language` (routes via `admins.language_owner_for`); OFG-only by default — set `push_hubspot=true` to also create a HubSpot task |
| `add_case_note` | OFG `client_id` (not HubSpot) + note; dry-run is safe preview (does not email — use `send_email`) |
| `upload_case_document` | Attach ID/SSN/utility/PDF to client file via `file_base64` + `doc_type`; dry-run then confirm; JPEG/PNG/HEIC/PDF ~3MB max; returns `source_sha256` / `integrity_ok`; optional `expected_byte_length` / `expected_sha256`. On refuse: `crm_required` with `user_message` + `crm_href` (finish in CRM) |
| `create_funding_application` | Funding board intake; `funding_type` + name + (email **or** phone), or `client_id` for dual; dry-run then confirm |
| `update_funding_status` | Move funding card status (not converted) |
| `convert_funding_application` | Funding → CR prospect (`status=prospect` + `funding_convert` label) |
| `upload_funding_document` | Funding doc slots (`funding_drivers_license`, corp, bank_m1–m6) via `file_base64` |
| `update_referrer` | Patch partner email/phone/company/name (fixes “no email on file”) |
| `attach_referrer` | Attach existing or inline-create partner onto a client (max 3 slots) |
| `send_email` | subject + body → branded email to a **client** (`client_id`) or **referrer** (`referrer_id` from `search_referrers` / `get_client`); auto-logs (client `admin_notes` and/or `referrers.notes`); optional `include_doc_upload_link=true` for client portal upload magic link only (never minted for partners); body is message-only (Hi/Hola greeting added automatically); dry-run never mints tokens or sends |
| `send_sms` | body → Twilio SMS from the acting admin’s OFG number to a **client** (`client_id`) or **referrer** (`referrer_id`); logs Conversations hub + SMS case note; returns `message_id`, Twilio SID, `provider_status`, `sent_at` for HubSpot; closed threads reopen on confirm |
| `send_text` | **Alias for `send_sms`** (ATLAS texting spec) — same dry-run → confirm flow; accepts `body` or `message` |
| `list_sms` | Read recent SMS/call hub messages for a client (use before replying) |
| `get_texts` | **Alias for `list_sms`** — inbound + outbound conversation history per client |
| `get_conversation` | **Alias for `list_sms` / `get_texts`** — same read endpoint; ATLAS spec name |
| `list_ofg_phone_numbers` | Verify which OFG Twilio business numbers are active/assigned to the connected admin (`all=true` for super_admin); includes `twilio_configured` and `acting_admin_from` |
| `update_pipeline_stage` | stage move (not prospect→new_client — use `preview_convert_prospect` then `convert_prospect`); `cancelled` ok for lost leads; fires reminder/CRC/referrer hooks |
| `preview_convert_prospect` | **Safe read-only** convert preview (use this first — avoids Claude “No approval received”) |
| `convert_prospect` | After preview: `confirm=true` + `CONFIRM` → New Client / onboarding (tasks yes, welcome email no) |
| `update_client_status` | `cancelled` / `paused` / `active` / etc. (not `prospect`) |
| `upsert_progress_report` | staff analysis; portal only shows PDF-published rows; `replace_published` to overwrite wizard PDF |
| `upsert_payment_splits` | `splits_json`; optional `send_payment_link` mints `/pay/:token` URLs; `replace_open=true` on HubSpot backfill |
| `update_payment_split` | mark paid / overdue / pending (cannot un-pay after ledger write) |
| `list_installments` | Includes `payment_link` when a token exists |

**Payment backfill:** export HubSpot balances → for each OFG client call `upsert_payment_splits` with `replace_open=true` (dry-run then confirm) → verify `list_clients_owing`.

Example: “New English lead Maria, 555…, realtor Bob 555…” → Claude previews → you say yes → created.

## Cursor (optional)

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "optimum-admin-ask": {
      "url": "https://www.ofgllc.com/api/mcp"
    }
  }
}
```

Then Customize → MCP → Connect → same consent flow.

## Discovery

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server/api/mcp`
- Authorize / token / register / revoke under `/api/mcp/oauth/*`

## Legacy stdio (ops only)

`mcp/admin-ask` still proxies `/api/admin/ai/tools` with `ADMIN_AI_MCP_TOKEN` for break-glass / CI. Prefer remote OAuth for people.
