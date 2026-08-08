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
- **Pipeline kanban** — Columns use `min(280px, calc(100vw - 2.5rem))` inside a scroll container. While `pipelineLoading` and the board has no data yet, show `PipelineBoardSkeleton` (shimmer cards matching avatar / progress / case-id layout) instead of empty columns.
- **Round calendar invites** — Optional `.ics` (METHOD:PUBLISH, 5 all-day VEVENTs) for planned round-completion dates. Persisted on `case_round_schedules` with stable UIDs / `calendar_send_count` (ICS SEQUENCE). Opt-in checkbox (default off) on Convert Prospect, New Case, and **Add Client** (lead type = client); edit/resend from Client panel → Schedule. Recipients: client, attached referrer (active + email), assigned language-owner admin. Round targets also appear on **Admin Calendar** (month chips) and **Dashboard** (upcoming 21 days).
- **OFG Progress Report Wizard** — Client panel Reports tab: Round 1 Before = enrollment PDF; Round N>1 auto-reuses published Round N−1 After as Before (copy into new session storage; override upload allowed). Structured account fingerprint matching + per-bureau win/target tags when detectable; report dates parsed from PDF text (editable in review). Round timeline strip shows score + after date per round; portal wins show TU/EX/EQ badges.
- **Prospect → New Client** — Drag a Prospect card onto New Client opens a convert confirmation with package, notes, and round calendar. Convert promotes (or creates) the case to New Client, assigns tasks, sends prospect-welcome email, optionally emails `.ics`, and schedules `payment_confirmed` Day 2/3 nudges (Day-0 skipped). **Click** a prospect opens the client panel (Overview + convert CTA; tasks empty until convert). **New Case** stage picker is limited to **Prospect** or **New Client** only (API rejects later stages) so cases are not created mid-pipeline with 0/N tasks. **New Case → Prospect** is minimal (pick lead only) — package/calendar/notes wait until convert. Leaving Prospect must go through convert (stage API rejects it). Convert dialog prefills round dates when a prospect-stage schedule already exists.
- **Team admin emails** — On first successful client purchase (enrollment), installment pay-link / manual split payments, when a client finishes all required Get Started tasks (ready for review), portal document uploads, and info-request submits — notify every active staff admin (`super_admin` / `admin` / `agent`, not affiliates) with a pipeline deep link **via email + in-app inbox** (SMS when Twilio is configured and the admin has a phone). Each admin can mute any alert per channel on **My profile** (`/admin/profile`); null prefs = all ON (legacy behavior). Intermediate per-task completes do not alert; re-submits of already-complete required sets do not re-alert until a reopen drops progress below 100%. Language-owner-only alerts still apply for “upload link sent.” Empty admin list logs a warning and skips send. Bell in the admin sidebar polls `/api/admin/me/notifications`.
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

- **Prospect model:** `clients.status='prospect'` + `pipeline_stage='prospect'`. Optional `credit_repair_cases` row at `pipeline_stage='prospect'` via New Case; convert (or paid registration) moves to `new_client`.
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

## Admin Work Hub (My Tasks)

- **Route:** `/admin/my-tasks` (nav **My Tasks**). Onboarding templates live at `/admin/tasks` as **Client Tasks**.
- **Board:** Kanban — Backlog / Doing / Done. Cards show source badge (`Optimum` | `HubSpot`), priority chip, due date, assignee (or Unassigned), optional linked case.
- **Case link:** Optional `case_id` on create/edit via case search picker (case number / client name). Cards deep-link to `/admin/pipeline?client={id}`.
- **Calendar:** Open tasks with a due date appear alongside rounds and payments (`adminCalendar.legendTasks`). Done tasks are omitted. Default filter **My tasks only** (toggle) to avoid HubSpot team-task clutter.
- **Dashboard:** “My open tasks” widget lists up to 8 tasks assigned to the current admin (overdue first).
- **DnD:** Native HTML5 drag (same pattern as Pipeline) — no extra DnD library.
- **HubSpot:** Optional extract. On HubSpot developer platform **2026.03**, Tasks API access uses **`crm.objects.contacts.read/write`** (not `crm.objects.tasks.*`). Prefer **`HUBSPOT_SERVICE_KEY`** with those contacts scopes, or Projects OAuth with the same scopes. Permitted admins sync via Sync now (Service Key) or Connect + Sync (OAuth). Until configured, header shows locked “HubSpot sync · Soon”.
- **i18n:** All chrome under `myTasks.*` / `clientTasksPage.*` / `adminNav.myTasks|clientTasks` / `adminCalendar.*` / `adminDashboard.myTasks*` (EN + ES).

## Affiliates

- **Staff invite links:** On **Affiliates**, managers create shareable signup URLs (`/affiliate/join/:tokenOrSlug`) — evergreen or one-time. **Standard plan only** for now. URL path: random token, auto slug from admin name, or custom slug. Join auto-comps. Public join page uses a brand header (no nav), labeled form, and required Terms + SMS/Privacy consent (`LegalConsent`; API rejects without `agreed_terms` / `agreed_sms`). Rows support enable/disable (separate from Used up / Expired badges), **edit** (label + path; Auto remint warned), and **delete**. Public resolve does **not** expose the opaque token. Rate-limited to 5 joins/hour/IP. Requires `AFFILIATES_ENABLED=1`.
