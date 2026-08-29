# Optimum Credit Design System

## Brand

- **Product name:** Optimum Credit (Optimum Financial Group)
- **Default theme:** Dark on marketing site and client portal (`class="dark"` on `<html>`)
- **Admin panel:** Light by default; optional dark mode via sidebar toggle (`optimum-admin-color-scheme`)
- **Client portal:** Dark by default (brand); optional light mode via sidebar toggle (`optimum-portal-color-scheme`)
- **Accent:** Gold `hsl(38 41% 58%)` — primary CTAs, rings, and highlights in dark mode
- **Background:** Deep navy / near-black (`#121829` theme-color)

## Logos

Hosted at `https://disruptinglabs.com/data/optimum/assets/images/logos/`:

| Asset                       | Use                                       |
| --------------------------- | ----------------------------------------- |
| `logo_with_title_white.png` | App chrome, auth panels, emails (dark UI) |
| `logo_with_title_dark.png`  | SEO / Open Graph                          |
| `logo_white.png`            | Compact nav mark                          |
| `logo_dark.png`             | Light-background contexts                 |

## Typography

- **Font:** Plus Jakarta Sans (see `client/global.css`)
- **Weights:** 400 body, 600–700 headings

## Tokens

CSS variables live in `client/global.css`. Tailwind maps them via `tailwind.config.ts`:

- `primary` — gold in dark mode, navy in light mode
- `accent` — gold highlights
- `muted` / `border` — neutral grays

## UI patterns

- Cards: `bg-card border border-border rounded-2xl`
- Primary actions: `btn-primary` (gold gradient in dark mode)
- Auth marketing panel: `#040a18` with gold-tinted grid (`AuthBrandPanel`)

## Admin form helpers

- `FieldHint` (`client/components/admin/FieldHint.tsx`) — one-line contextual note under a form control. `tone="muted"` (default, neutral), `"warning"` (`border-destructive/25 bg-destructive/5`), or `"accent"` (`border-primary/20 bg-primary/5`). Never use arbitrary colors (e.g. `amber-*`) for these — use `tone` instead.
- `EnumLegend` (`client/components/admin/EnumLegend.tsx`) — compact legend for enum selects (status, role, filter, etc). Pass `items` (`value`/`label`/`description`), the current `value` to highlight the active row, and an optional `title`.
- Copy for both lives under the `adminHelpers.*` i18n namespace (and `adminPipeline.*` for pipeline/case-specific copy) — always add new hint strings there in both `en` and `es`, never hardcode.

## Mobile responsiveness

- **No horizontal page scroll** — `html`, `body`, and `#root` use `overflow-x: hidden`; layouts use `max-w-[100vw]`, `min-w-0`, and `.app-page`.
- **Admin / portal shells** — Main content is `overflow-x-hidden`; sidebar drawers lock `body` scroll on mobile.
- **Tables** — Wrap in `.table-scroll` (internal horizontal scroll only). `DataGrid` avoids negative margins on small screens.
- **Pipeline kanban** — Columns use `min(280px, calc(100vw - 2.5rem))` inside a scroll container. Server-side per-column pagination (default 20/page, **Show more**); badge counts use column `total`. While `pipelineLoading` and the board has no data yet, show `PipelineBoardSkeleton` (shimmer cards matching avatar / progress / case-id layout); refresh keeps cards with soft opacity.
- **Round calendar invites** — Optional `.ics` (METHOD:PUBLISH, 5 all-day VEVENTs) for planned round-completion dates. Persisted on `case_round_schedules` with stable UIDs / `calendar_send_count` (ICS SEQUENCE). Opt-in checkbox (default off) on Convert Prospect, New Case, and **Add Client** (lead type = client); edit/resend from Client panel → Schedule. Recipients: client, attached referrer (active + email), assigned language-owner admin. Round targets also appear on **Admin Calendar** (month chips) and **Dashboard** (upcoming 21 days).
- **OFG Progress Report Wizard** — Client panel Reports tab: Round 1 Before = enrollment PDF; Round N>1 auto-reuses published Round N−1 After as Before (copy into new session storage; override upload allowed). Structured account fingerprint matching + per-bureau win/target tags when detectable; report dates parsed from PDF text (editable in review). Round timeline strip shows score + after date per round; portal wins show TU/EX/EQ badges.
- **Prospect → New Client** — Drag a Prospect card onto New Client opens a convert confirmation with package, notes, and round calendar. Convert promotes (or creates) the case to New Client, assigns tasks, sends prospect-welcome email, optionally emails `.ics`, and schedules `payment_confirmed` Day 2/3 nudges (Day-0 skipped). **Click** a prospect opens the client panel (Overview + convert CTA; tasks empty until convert). Deep link `/admin/pipeline?client={id}` or `?case={id}` (or both) opens that panel even when the card is not on the first loaded page. **New Case** stage picker is limited to **Prospect** or **New Client** only (API rejects later stages) so cases are not created mid-pipeline with 0/N tasks. **New Case → Prospect** is minimal (pick lead only) — package/calendar/notes wait until convert. Leaving Prospect must go through convert (stage API rejects it). Convert dialog prefills round dates when a prospect-stage schedule already exists.
- **Team admin emails** — On first successful client purchase (enrollment), installment pay-link / manual split payments, when a client finishes all required Get Started tasks (ready for review), portal document uploads, and info-request submits — notify staff **via email + in-app inbox** (SMS when Twilio is configured and the admin has a phone). **Inbound SMS** / **missed call** / **voicemail** alert the **OFG line assignee** only (email + in-app bell + optional SMS alert to their profile phone when SMS prefs are on — alert text, not a full SMS relay). **Settings → Team notifications** lists staff prefs and **extra emails** (`admin_notify_extra_emails.events_json`; null = all types). Extras are for ops copies of **team** alerts — do not leave them on “all types” or every SMS/missed call fans out to support/lino/angel. Joe Pepe is funding-only. Super admins manage this in Settings.ettings; individuals can still fine-tune on **My profile**. Null prefs = all ON (legacy behavior). Intermediate per-task completes do not alert; re-submits of already-complete required sets do not re-alert until a reopen drops progress below 100%. Language-owner-only alerts still apply for “upload link sent” (convert welcome, admin create welcome, Ask `send_email` with upload link, and **payment_confirmed Day‑0 welcome**). Empty admin list logs a warning and skips send. Bell loads `/api/admin/me/notifications` on admin shell mount, refreshes when opened, and on Ably `admin:{id}:notifications` push (no interval polling).
- **Reminder queue cron** — Day‑2/3 upload nudges and other delayed emails sit in `notification_queue` until `GET|POST /api/cron/process-queue` runs (Vercel Cron every **5 minutes** via `vercel.json`, or cPanel curl). Auth: `Authorization: Bearer CRON_SECRET` (Vercel) or `x-cron-secret`. Claims use a unique tag (overlap-safe); stuck `processing` claims older than 15m are reclaimed; pending rows older than 14 days are cancelled as stale. Without this cron, only Day‑0 immediate sends go out.
- **Forms** — Prefer `grid-cols-1 sm:grid-cols-2`; toolbars use `.toolbar-row` or `flex-col sm:flex-row`.
- **Optional client email** — Add Client / Prospect / affiliate leads / bulk CSV allow empty email when phone is present (or vice versa). `NoEmailWarning` shows a destructive-toned alert listing what email-only automation will skip (portal invite, reminders, convert welcome). Reminder `send_email` steps, split payment-due queue, convert/case welcome, and CRC `<email>` tag no-op safely when the client has no address. Task remind returns 422. Sub-affiliate invites still require email (login identity). Public registration still requires email.

## Checkout types

Packages use `checkout_type`:

- `fixed_price` — single amount at registration
- `tradeline_picker` — multi-select catalog; total = sum of selections
- `subscription` — Peace of Mind ($49.99/mo); portal-only after `completed` stage

## Payment installments

Each installment has a **collection mode**:

- **Manual** — on the schedule only; admin marks paid later; no client `/pay` link
- **Payment link** — creates `/pay/:token`; client can pay via Authorize.net; admin can copy/generate the link
- **Already paid** — recorded paid at creation (`completion_source: manual`); no client notification or link

Surfaces: New Case schedule, Client panel Payment Schedule, Admin Payments splits tab, Calendar day panel (shared `AdminSplitActions`).

## Prospects + Credit Analysis

- **Prospect model:** Unconverted leads on the Prospect column are `status='prospect'` **or** `pipeline_stage='prospect'` (not cancelled, no enrolled active non-prospect case). Healthy leads keep both fields `prospect`. Optional `credit_repair_cases` row at `pipeline_stage='prospect'` via New Case; convert (or paid registration) moves to `new_client`. Do not use `pending_payment` as a stand-in for “still a lead.”
- **Public surfaces:** `/credit-analysis` (full PDF analysis) and homepage lead form (`CreditAnalysisLeadForm` → `lead_source=get_started`).
- **Labels:** Source layer (`web_analysis`, `get_started_wizard`, …) + analysis layer (housing, collections, …). Shown on Pipeline cards (prospects + cases), Clients filters, and optional Reminder Flow audience (`required_label_slugs`).
- **Convert:** Admin confirm → `onboarding` / `new_client` + case + auto-assigned tasks + dedicated welcome email with magic link `/portal/onboarding/:token`.
- **Paid register:** Existing prospect emails are reused (not 409); payment success flips prospect → onboarding and creates the first case.
- **PDF honesty:** API returns `extraction_status` (`ok` | `empty` | `parse_failed` | `unsupported_type`). When not `ok`, UI must warn and must not claim “no negatives / great shape”.
- **Analyst algorithm:** `POST /api/public/credit-analysis` runs a deterministic Optimum playbook (inlined in `api/index.ts`) — FICO bands, goal-based lending conversion (FHA / Conventional / Jumbo / Auto / Business / General), prioritized negatives, utilization paydowns, 30/60/90 timeline, dispute rounds, file strength (goal-adaptive labels), 6-step action plan, and client SMS copy (EN/ES). Response includes flat `analyst` JSON + branded HTML (navy `#121829` / gold `#C0A06A`). Persisted as `credit_analyses.analyst_json`.
- **Stage moves:** Confirm dialog on any pipeline stage change (forward, back, or jump). Entering `docs_ready` triggers the `docs_ready` reminder flow. Entering `completed` (“graduating clients”) triggers the `completed` reminder flow — celebration email `flow_completed` / `flow_completed_es` (Cesar’s “credit file is clean” copy, Optimum Financial Group signature). Phone-only clients skip the email step safely.

### Smoke checklist

1. Homepage lead → prospect appears in Pipeline prospect column with `get_started_wizard` (+ `web_analysis`).
2. `/credit-analysis` with a text SmartCredit PDF → scores/negatives + optional email; scan/image PDF → limited-read warning, no “great shape”.
3. Convert prospect → case at `new_client`, tasks assigned, welcome email link opens `/portal/onboarding/:token`.
4. Prospect email completes `/register` pay → onboarding + case (not duplicate-account 409).
5. Move case to `docs_ready` (admin drag or CRC) → `docs_ready` reminder flow runs; label-gated flows skip clients missing required labels.
6. Move case to `completed` → graduating celebration email (EN/ES by `preferred_language`); subject “Congratulations — Your Credit File Is Clean!” / “¡Felicidades — Su archivo de crédito está limpio!”
7. Pipeline case cards show client labels; Clients page label filter works.

## Admin AI Ask

- **Flag:** `ADMIN_AI_ENABLED` (off by default). Single kill switch; Anthropic key is separate (`ANTHROPIC_API_KEY`, billed outside the app). Default model `claude-sonnet-4-6` (`ANTHROPIC_MODEL` override). Do not use retired `claude-sonnet-4-20250514`.
- **MCP:** Remote Streamable HTTP at `/api/mcp` with **OAuth 2.1 + PKCE** per admin (logic inline in `api/index.ts`). Primary client: **Claude custom connector**. Consent at `/admin/mcp-consent`; revoke in My profile. Each tool advertises its own JSON Schema (converted from `ADMIN_AI_TOOLS`). MCP `readOnlyHint` is true so Claude dry-runs are not blocked by UI approval; writes still require `confirm=true` + `confirm_phrase=CONFIRM` (`idempotentHint` false on write tools). Remote tool calls are audited + rate-limited like REST tools. DCR redirect URIs must be known Claude/Cursor callbacks / loopback / `cursor:`; deny uses the same allowlist. Tools: read CRM + guided writes (prospects, notes, `send_email`, `send_sms`/`send_text`, `list_sms`/`get_texts`/`get_conversation`, `list_ofg_phone_numbers`, stage/status, convert, progress analyses, payment splits). `create_work_task` is OFG-only unless `push_hubspot=true`. Optional legacy `ADMIN_AI_MCP_TOKEN` for ops only.
- **Who:** `super_admin` + `admin` only (not agents/affiliates). Surfaced as `user.ai_ask_enabled` from `/api/auth/admin/me`.
- **UI:** Right-edge vertical **Ask** pull tab (mid-screen; Mortgi-style; hides while drawer open — never covers composers/Send) + **Ask about case** on the client panel. Right `Sheet` chat (`AdminAskDrawer`); assistant replies render compact Markdown (`AdminAskMarkdown`); optional case/client context chip + citations.
- **Tools:** Read CRM (`search_clients`, `search_referrers`, `get_case`, `pipeline_summary`, reports, docs, payments/installments/owing, round schedule, work tasks, `list_sms`/`get_texts`/`get_conversation`, `list_ofg_phone_numbers`) + guided writes (`create_prospect`, `create_work_task`, `add_case_note`, `upload_case_document`, `send_email`, `send_sms`/`send_text`, `update_pipeline_stage`, `preview_convert_prospect`, `convert_prospect` (unconverted leads even if status is active/pending_payment; blocked after an enrolled case), `update_client_status` (may set `prospect`/`paused`/`cancelled` for unconverted leads; MCP refuses `pending_payment`/`onboarding`/`active` until an enrolled case exists — use convert instead; cannot set `prospect` after enroll), `upsert_progress_report` (fires personal-info progress alerts to team), `upsert_payment_splits` / `update_payment_split` / `list_installments` (includes `payment_link` when minted), `update_referrer`, `attach_referrer` (max 3 partners), funding create/status/convert/upload — dry-run then `confirm=true`). `create_funding_application` accepts name + email **or** phone (phone-only household leads). `upload_case_document` attaches JPEG/PNG/HEIC/PDF (~3MB) to a client case via base64 + `doc_type` (same CDN/encryption as admin portal). `send_email` sends branded email via platform mailer (Resend) to a **client** (`client_id`) or **referrer** (`referrer_id` from `search_referrers` / `get_client.referrer`); client sends auto-log an EMAIL case note (`include_doc_upload_link` mints portal upload link — client-only, never minted for partners). Referrer sends log on `referrers.notes` and, if `client_id` is also passed, on the client's file. `send_sms`/`send_text` texts via Twilio from the acting admin’s assigned OFG number into Conversations + SMS case note (returns `message_id` / Twilio SID / `provider_status` / `sent_at` for HubSpot). Inbound client SMS auto-stamps the case file; `list_sms`/`get_texts`/`get_conversation` read the hub timeline before replies. `list_ofg_phone_numbers` confirms which business lines are assigned (`acting_admin_from`). `get_client` returns `referrers[]` multi-partner slots. Prefer `preview_convert_prospect` before convert (avoids Claude “No approval received” on dry-run). `create_work_task` is OFG-only unless `push_hubspot=true` (avoids Claude+platform HubSpot duplicates); language owners come from `admins.language_owner_for` (set in People / team admin). MCP advertises `readOnlyHint: true` so Claude dry-runs are not blocked by UI approval; API still requires `confirm_phrase=CONFIRM`. Client portal lists only PDF-published progress reports (MCP drafts stay staff-only). Anthropic tool loop max 4 rounds / ~50s wall. No free SQL. Global Ask clears case context; panel **Ask about case** sets it.
- **Audit:** every turn writes `admin_ai_audit_logs` (question, tools used, tokens).
- **i18n:** `adminAsk.*` (EN + ES).

## Admin Conversations (Contact Hub)

- **Access:** Only staff with an assigned row in `admin_phone_numbers` (`user.conversations_enabled` from `/api/auth/admin/me`). Nav shows a lock for others; APIs return `403 conversations_number_required`. **Inbox scope:** client list/timeline show threads on **your OFG line(s)** or **assigned to you** — not a company-wide SMS CRM (same idea as unknown queue + recording proxy). **All** = all of those, not every staff member’s chats. Super admin has no special bypass.
- **Enrollment / Docs Verified:** Paying CR clients must **convert** (Prospect → New Client) to create a case + onboarding tasks. Admin cannot set `status=active|onboarding|pending_payment` without an enrolled case (`422 use_convert_prospect`). **Docs Verified** = all required tasks **approved** (not upload count); case/client/MCP stage moves share one gate. Reports R1 unlocks at `docs_ready`.
- **Channels:** SMS/MMS + internal notes only (email will be a separate module).
- **SMS From:** No `TWILIO_PHONE_NUMBER` env. Every outbound SMS uses the acting staff’s assigned OFG number from `admin_phone_numbers`. Staff without a number get no SMS notify, no SMS OTP, and client SMS from their actions is skipped.
- **Compose:** **New message** — unified recipient field (`ConversationComposeTargetPicker`: search clients or enter a phone for cold outbound via `POST /admin/conversations/start`). Unknown threads use the same composer (SMS only). **Pipeline client panel** header shows **Message** (`ClientPanelConversationButton`) when `user.conversations_enabled` — deep-links to `/admin/conversations?client={id}`. SMS supports **MMS attach** (image/video/audio/PDF ≤4MB) with an instant local **blob preview** (same as real-state); upload still yields the public media URL for Twilio. **Suggested replies:** pipeline-aware static chips (`client/lib/conversationSuggestedReplies.ts`) on all threads + optional **Suggest with AI** (`POST /admin/conversations/suggest-replies`, requires `ADMIN_AI_ENABLED` + Anthropic key). Timeline status shows a Lucide icon always; hover tooltip shows the status label (`ConversationMessageStatus`). First visit shows a dismissible **Quick start** guide; New message includes tip chips + quick-starter bodies. Loading uses `ConversationsHubSkeleton` (shimmer list + timeline) **only on first hub paint**; background inbox/timeline refresh keeps existing rows with soft opacity (never skeleton flash on inbound).
- **Close / reopen:** Close clears the active inbox (**All / Mine / Unknown / Open / Unread**) — find them under **Closed**. Threads stay usable: open from Closed, composer stays available, **sending or calling auto-reopens**. Explicit Reopen still available. Inbound SMS/call also auto-reopens. **Dismiss** on unknowns remains separate.
- **Unknown → prospect:** Quick create (name, email, language, optional pipeline case) lives in a **collapsed header panel** on unknown threads so the message timeline stays visible; expand to act, then **Client panel** opens for full profile. Duplicate-phone guard with confirm. Link or dismiss still available.
- **MMS:** Upload → `mms_media` + public `GET /api/conversations/media/public/:id` (Twilio-fetchable Content-Type). Public base comes from **`OPTIMUM_API_BASE_URL`** (then `PUBLIC_APP_URL`, then `https://www.ofgllc.com`), skipping localhost so Twilio can fetch. Optional DisruptingLabs archival via `CDN_UPLOAD_*` / `MMS_UPLOAD_*`. Inbound Twilio `NumMedia` is re-hosted when possible; if the row still stores a Twilio `MediaUrl`, the timeline uses **`GET /api/conversations/media?url=&token=`** (real-state pattern) so `<img>` works without browser Basic auth. Retention **365 days**; expired rows cleaned by `/api/cron/process-queue`. Max **4MB** (Vercel body limit). Send only accepts our public media paths (no open relay).
- **Case/funding docs CDN:** Encrypted blobs upload to HostGator-hosted `disruptinglabs.com` (`uploadToCDN`). Outside SSL/host blips historically surface as Node `fetch failed`. Production uses timeout + retries; **Vitest stubs** the live host so deploy tests do not depend on CDN uptime. Cert AutoSSL on that host must stay valid (Let’s Encrypt on `*.disruptinglabs.com`). **Upload size:** admin case docs, report-wizard PDFs, and MMS share a **4 MB** Vercel-safe ceiling (clear `413` + UI hints). MCP `upload_case_document` remains ~3 MB decoded base64 and returns `source_byte_length` / `source_sha256` / `stored_byte_length` / `integrity_ok` (optional `expected_byte_length` / `expected_sha256` reject truncated payloads before store). When MCP cannot complete an action (size, mime, no case, integrity), tools return **`crm_required`** (`reason`, `user_message`, `crm_href`, `crm_action`) — ATLAS must tell staff to finish in CRM and stop retrying.
- **Templates:** Separate `conversation_templates` table (not reminder `communication_templates`). Manage under **Templates → Conversations**. Composer **Templates** menu inserts body; type `{{` for variable suggestions (`first_name`, `portal_url`, …). Vars fill on send from the open contact. Channels: SMS + internal notes only.
- **Realtime:** Twilio webhook → DB write → Ably publish on `admin:{id}:conversations` when `ABLY_API_KEY` is valid. Payloads include a **contact snapshot** for in-place inbox patches (real-state `thread-updated` pattern). Client uses a **shared Ably singleton** (`client/lib/ably-client.ts`) with **one token probe per tab** when key is missing/invalid. With Ably live: push updates only + 5‑min contacts backstop. Without Ably: **contacts-only poll every 30s** (throttled). **Sidebar:** `GET /admin/conversations/badge` drives a green unread pill on **Conversations**; inbound SMS plays a short chime (`client/lib/notification-sound.ts`, debounced) when **In-app → Inbound SMS** is on and **My profile → Play chime** is enabled. Audio unlocks on first click/key in the admin shell (browser autoplay). Outbound SMS sets Twilio `statusCallback` → `/api/webhooks/twilio/sms-status`. **Set `ABLY_API_KEY`** in `.env` / Vercel.
- **Voice (Twilio Voice SDK):** Browser softphone via `GlobalVoiceManager` (mounted in `AdminLayout` when `conversations_enabled`). **Dial pad** + **Call settings** modal (gear) in Conversations toolbar — availability, call forwarding to cell, voicemail greeting, **Fix call setup** (syncs TwiML App + OFG number voice/SMS webhooks). Dialpad is a **bottom sheet on small screens** (safe-area + sticky Call) so Safari iPhone does not clip the Call button. Outbound/inbound calls log to `conversation_messages` (`channel=call`). Inbound rings **only the assigned admin** for the OFG number. With forwarding on: rings the cell using the **OFG number as CallerID** (avoids carrier spam/`busy` when the client CID would be presented) + keypress gate so carrier VM cannot steal the call; softphone is dialed when **Available**, or as fallback when cell cannot ring (e.g. caller is the forward-to number). No-answer/`busy` → CRM voicemail + missed-call alert. **Alerts:** `missed_call` + `voicemail` (email/in-app/SMS prefs + Ably bell chime when In-app toggles + Profile sound are on). Twilio webhooks: `/api/voice/incoming`, `/api/voice/dial-status`, voicemail callbacks. Env: `TWILIO_API_KEY`, `TWILIO_API_SECRET`, optional `TWILIO_TWIML_APP_SID`.
- **OTP:** Admin login can offer Email | SMS when the staff profile has a personal phone **and** an assigned OFG number (Twilio SID/token configured).
- **i18n:** `conversations.*`, `adminLogin.chooseChannel*`, `adminNav.conversationsNumberRequired` (EN + ES).


- **Route:** `/admin/my-tasks` (nav **My Tasks**). Onboarding templates live at `/admin/tasks` as **Client Tasks**.
- **Board:** Kanban — Backlog / Doing / Done. Cards show source badge (`Optimum` | `HubSpot`), priority chip, due date, assignee (or Unassigned), optional linked case. Server-side search + per-column pagination (20/page, **Show more**). Loading uses `MyTasksBoardSkeleton` (shimmer).
- **Case link:** Optional `case_id` on create/edit via case search picker (case number / client name). Cards deep-link to `/admin/pipeline?client={id}`.
- **Calendar:** Open tasks with a due date appear alongside rounds and payments (`adminCalendar.legendTasks`). Done tasks are omitted. Default filter **My tasks only** (toggle) to avoid HubSpot team-task clutter.
- **Dashboard:** “My open tasks” widget lists up to 8 tasks assigned to the current admin (overdue first).
- **DnD:** Native HTML5 drag (same pattern as Pipeline) — no extra DnD library.
- **HubSpot:** Optional extract. On HubSpot developer platform **2026.03**, Tasks API access uses **`crm.objects.contacts.read/write`** (not `crm.objects.tasks.*`). Prefer **`HUBSPOT_SERVICE_KEY`** with those contacts scopes, or Projects OAuth with the same scopes. Permitted admins sync via Sync now (Service Key) or Connect + Sync (OAuth). Until configured, header shows locked “HubSpot sync · Soon”.
- **i18n:** All chrome under `myTasks.*` / `clientTasksPage.*` / `adminNav.myTasks|clientTasks` / `adminCalendar.*` / `adminDashboard.myTasks*` (EN + ES).

## Affiliates

- **Staff invite links:** On **Affiliates**, managers create shareable signup URLs (`/affiliate/join/:tokenOrSlug`) — evergreen or one-time. **Standard plan only** for now. URL path: random token, auto slug from admin name, or custom slug. Join auto-comps. Public join page uses a brand header (no nav), labeled form, and required Terms + SMS/Privacy consent (`LegalConsent`; API rejects without `agreed_terms` / `agreed_sms`). Rows support enable/disable (separate from Used up / Expired badges), **edit** (label + path; Auto remint warned), and **delete**. Public resolve does **not** expose the opaque token. Rate-limited to 5 joins/hour/IP. Requires `AFFILIATES_ENABLED=1`.

## Business Funding

- **Public wizard** `/funding`: Same standalone shell as **Register** — gradient background, sticky header, `card-base` step card, **`PublicWizardFooter`** (trust badges, theme toggle, legal links), semantic tokens for light + dark.
- **Data:** `funding_applications` + `clients.status=funding` (excluded from CR Prospect). Docs on `client_documents` with funding doc_types; SSN/EIN via `secrets_ciphertext` (AES-GCM). Both funding types require the full 8-slot checklist.
- **Admin board** `/admin/funding`: status columns (not CR Pipeline); **server search + filters + paginated columns** (Pipeline-style load-more); detail sheet masks SSN/EIN as present/absent; Convert to Prospect; **New application** modal (optional client link + manual lead, mirrors Pipeline **New Case**); nav `sectionKey: funding`.
- **Portal** `/portal/funding`: shown in ClientLayout only when a funding application exists; remaining doc uploads + status.
- **Notify:** event `funding_doc_upload` (staff prefs + extra emails; Joe Pepe seeded email-only). Event `funding_application_created` when staff manually adds an application (team alert + client email with `/funding?token=…` wizard link). Client confirmation email+SMS when all docs are in — SMS From = Settings `funding_sms_from_phone_number_id` (defaults to Cesar OFG line when present). Atomic `docs_complete_notified_at` claim prevents duplicate client confirms. Convert attaches `funding_convert` source label.
- **Public API:** rate-limited; uploads locked after `complete` / `converted` / `cancelled`.
- **Settings:** super-admin picks OFG From number via `funding_sms_from_phone_number_id` (phone inventory select).
- **Colors:** semantic tokens only — no hardcoded `#0b0f1a` / `bg-white` on the wizard shell.
- **i18n:** `funding.*`, `adminFunding.*`, `portalFunding.*`, `adminNav.funding`, `adminNotifications.events.funding_doc_upload`, `adminNotifications.events.funding_application_created`, `adminSettings.fundingSms*`.