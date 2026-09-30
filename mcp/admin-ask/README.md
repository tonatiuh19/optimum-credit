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
| `search_contacts` / `get_contact` | CRM Contacts address book (not pipeline); active/unconverted only |
| `list_funding_applications` / `get_funding_application` | Funding board search + one app + docs uploaded |
| `funding_pipeline_summary` | Funding column counts (use instead of CR `pipeline_summary`) |
| `list_round_schedule` | Round calendar dates |
| `list_progress_reports` / `get_progress_report` | Published rounds + Wizard drafts/confidence; hand off PDF publish to CRM Reports → Generate. Special clients may use rounds 6–12 (`max_rounds` on case — set in CRM Reports, not MCP) |
| (+ existing search/pipeline/reports/tasks) | |

Each tool advertises its own JSON Schema over MCP (not a shared stub). MCP sets `readOnlyHint: true` so Claude dry-runs are not blocked by UI approval; **writes still require** `confirm=true` + `confirm_phrase: "CONFIRM"` in the tool args (API-enforced).

### Write tools (guided — dry-run then confirm)

Claude must collect fields, call with `confirm=false` (preview), show the user, then `confirm=true` + `confirm_phrase: "CONFIRM"`.

| Tool | Required / notes |
|---|---|
| `create_work_task` | title + named staff (`assignee_admin_id` / `assignee_name` via `search_admins`) **or** `preferred_language` fallback to `admins.language_owner_for`; OFG-only by default — set `push_hubspot=true` to also create a HubSpot task |
| `update_work_task` | Patch an existing task (`task_id` from `search_work_tasks`): reassign via `assignee_name` / `assignee_admin_id`, retitle, due date, status, priority, case link. Dry-run then confirm. Do not create a duplicate. |
| `create_prospect` | first/last/phone/`preferred_language`; optional `assigned_admin_id` / `assigned_admin_name` when a person is named (overrides language owner); realtor → `referral_category=realtor_broker` + referrer name/phone/email; hard phone/email match returns `existing:true` + `client_id` (never inserts a twin); rejects placeholder phones |
| `create_contact` | Address-book only (not Pipeline): first/last + phone **or** email; optional `assigned_admin_*`; dry-run then confirm; `confirm_duplicate` on phone/email matches |
| `update_contact` | Patch CRM contact fields (including `assigned_admin_*`); dry-run then confirm |
| `convert_contact` | Contact → Pipeline prospect; optional `assigned_admin_*` override; re-links Conversations; dry-run then confirm; phone/email match **links** to existing client (`existing:true`) — never creates a twin |
| `send_contact_sms` | SMS a CRM Contact by `contact_id` (not `client_id`); Twilio From = acting admin’s OFG number unless `from_admin_*` / `from_phone_number_id`; logs Conversations hub + `[SMS …]` on `contacts.admin_notes`; dry-run then confirm |
| `send_contact_email` | Email a CRM Contact by `contact_id`; branded Resend mailer; logs `[EMAIL …]` on `contacts.admin_notes`; dry-run then confirm; no portal upload links |
| `add_case_note` | OFG `client_id` (not HubSpot) + note; dry-run is safe preview (does not email — use `send_email`) |
| `upload_case_document` | Attach ID/SSN/utility/PDF to client file via `file_base64` + `doc_type`; dry-run then confirm; JPEG/PNG/HEIC/PDF ~4MB max; returns `source_sha256` / `integrity_ok`; optional `expected_byte_length` / `expected_sha256`. On refuse: `crm_required` with `user_message` + `crm_href` (finish in CRM) |
| `run_credit_analysis` | Free pre-sale analysis for **prospects** — `client_id` + credit-report PDF via `file_base64`; no enrolled case required; dry-run then confirm; optional `client_goal`, `text_language`, `email_opt_in` |
| `create_funding_application` | Funding board intake; `funding_type` + name + (email **or** phone), or `client_id` for dual; dry-run then confirm |
| `update_funding_status` | Move funding card status (not converted) |
| `convert_funding_application` | Funding → CR prospect (`status=prospect` + `funding_convert` label) |
| `upload_funding_document` | Funding doc slots (`funding_drivers_license`, corp, bank_m1–m6) via `file_base64` |
| `update_referrer` | Patch partner email/phone/company/name (fixes “no email on file”) |
| `attach_referrer` | Attach existing or inline-create partner onto a client (max 3 slots) |
| `send_email` | subject + body → branded email to a **client** (`client_id`), **referrer** (`referrer_id`), or **staff** (`to_admin_id` / `to_admin_name` from `search_admins`); auto-logs (client `admin_notes` and/or `referrers.notes`); optional `include_doc_upload_link=true` for client portal upload magic link only (never minted for partners); optional single attachment via `attachment_case_document_id`, `attachment_round_report_id`, or `attachment_base64`+`attachment_filename` (~4MB max); body is message-only (Hi/Hola greeting added automatically); dry-run never mints tokens or sends; on `no_email` use `update_client` first. For address-book Contacts use `send_contact_email` |
| `send_round_report` | Resend a **published** Round PDF with the same secure delivery as Wizard publish: mint `/api/public/round-report-pdf/:token`, branded Round-complete email (portal + Download PDF CTAs, optional PDF attach), optional twin SMS; resolve via `pdf_id` / `round_report_id` / `round_number` from `list_progress_reports`; defaults `also_email`/`also_sms`/`attach_pdf`/`notify_partners` true; dry-run then confirm |
| `update_client` | Patch contact fields: `email` / `phone` / `first_name` / `last_name` / `preferred_language` / `assigned_admin_*`. Named staff owner wins over language-owner reassignment. Dry-run then confirm. Does **not** change status/pipeline (use `update_client_status` / convert / stage tools) |
| `send_sms` | body (max **1600** chars; rejects `sms_body_too_long` if over) → Twilio SMS. Default From = MCP-connected admin’s OFG number; override with `from_admin_id` / `from_admin_name` / `from_phone_number_id`. To = **client** (`client_id`), **referrer** (`referrer_id`), or **staff** (`to_admin_*`); logs Conversations hub + SMS case note for clients; returns `message_id`, Twilio SID, `provider_status`, `sent_at` for HubSpot; closed threads reopen on confirm. For address-book Contacts use `send_contact_sms` |
| `send_text` | **Alias for `send_sms`** (ATLAS texting spec) — same dry-run → confirm flow; accepts `body` or `message` |
| `list_sms` | Read recent SMS/call hub messages for a client (use before replying); call rows include `call_insights_status` + short `insights_summary` when ready |
| `get_call_insights` | Claude call/voicemail resume — sentiment, feelings, topics, action items, risk flags, transcript (`message_id` optional) |
| `get_texts` | **Alias for `list_sms`** — inbound + outbound conversation history per client |
| `get_conversation` | **Alias for `list_sms` / `get_texts`** — same read endpoint; ATLAS spec name |
| `list_ofg_phone_numbers` | Verify which OFG Twilio business numbers are active/assigned to the connected admin (`all=true` for super_admin); includes `twilio_configured` and `acting_admin_from` |
| `update_pipeline_stage` | stage move (not prospect→new_client — use `preview_convert_prospect` then `convert_prospect`); `cancelled` ok for lost leads; fires reminder/CRC/referrer hooks |
| `preview_convert_prospect` | **Safe read-only** convert preview (use this first — avoids Claude “No approval received”) |
| `convert_prospect` | After preview: `confirm=true` + `CONFIRM` → New Client / onboarding (tasks yes, welcome email no) |
| `update_client_status` | `cancelled` / `paused` / `active` / etc. (not `prospect`) |
| `upsert_progress_report` | **Staff notes only** — requires `score_before` + `score_after` (300–850; never invent). Does **not** upload Before/After PDFs or publish the branded client PDF (use CRM **Reports → Generate**). Portal only shows Wizard-published PDFs. Overwriting a published PDF/wizard row returns `crm_required` / `published_exists` unless `replace_published=true` after explicit user approval |
| `set_case_payment_plan` | **Preferred for discounted Zelle/cash deals** — `total_cents` + optional `installments_json`; defaults `replace_open=true` so OFG balance = agreed total (not coupon codes). Optional `mark_paid` + `payment_method` + `case_note` |
| `upsert_payment_splits` | `splits_json`; `status=paid` updates matching open row by due+amount (no pending twin); skips if already paid; optional `send_payment_link`; `replace_open=true` on HubSpot backfill |
| `update_payment_split` | **Preferred** to mark a known installment paid / overdue / pending (cannot un-pay after ledger write); optional `payment_method` on paid |
| `list_coupons` | List checkout promo codes (Admin → Payments → Coupons) |
| `create_coupon` | Create a **/register checkout** promo code (dry-run then confirm). Not for offline Zelle — use `set_case_payment_plan` |
| `list_installments` | Includes `payment_link` when a token exists |

**Payment backfill / deals:** Discounted offline deals → `set_case_payment_plan`. Checkout promo codes → `create_coupon`. HubSpot balance import → `upsert_payment_splits` with `replace_open=true`. To record a Zelle/cash payment against an existing schedule, use `update_payment_split(split_id, status=paid)`.

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
