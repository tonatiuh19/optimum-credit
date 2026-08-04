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
- **Pipeline kanban** — Columns use `min(280px, calc(100vw - 2.5rem))` inside a scroll container.
- **Forms** — Prefer `grid-cols-1 sm:grid-cols-2`; toolbars use `.toolbar-row` or `flex-col sm:flex-row`.

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

- **Prospect model:** `clients.status='prospect'` + `pipeline_stage='prospect'`. No `credit_repair_cases` row until convert or paid registration.
- **Public surfaces:** `/credit-analysis` (full PDF analysis) and homepage lead form (`CreditAnalysisLeadForm` → `lead_source=get_started`).
- **Labels:** Source layer (`web_analysis`, `get_started_wizard`, …) + analysis layer (housing, collections, …). Shown on Pipeline cards (prospects + cases), Clients filters, and optional Reminder Flow audience (`required_label_slugs`).
- **Convert:** Admin confirm → `onboarding` / `new_client` + case + auto-assigned tasks + dedicated welcome email with magic link `/portal/onboarding/:token`.
- **Paid register:** Existing prospect emails are reused (not 409); payment success flips prospect → onboarding and creates the first case.
- **PDF honesty:** API returns `extraction_status` (`ok` | `empty` | `parse_failed` | `unsupported_type`). When not `ok`, UI must warn and must not claim “no negatives / great shape”.
- **Analyst algorithm:** `POST /api/public/credit-analysis` runs a deterministic Optimum playbook (inlined in `api/index.ts`) — FICO bands, goal-based lending conversion (FHA / Conventional / Jumbo / Auto / Business / General), prioritized negatives, utilization paydowns, 30/60/90 timeline, dispute rounds, file strength (goal-adaptive labels), 6-step action plan, and client SMS copy (EN/ES). Response includes flat `analyst` JSON + branded HTML (navy `#121829` / gold `#C0A06A`). Persisted as `credit_analyses.analyst_json`.
- **Stage moves:** Confirm dialog on any pipeline stage change (forward, back, or jump). Entering `docs_ready` triggers the `docs_ready` reminder flow.

### Smoke checklist

1. Homepage lead → prospect appears in Pipeline prospect column with `get_started_wizard` (+ `web_analysis`).
2. `/credit-analysis` with a text SmartCredit PDF → scores/negatives + optional email; scan/image PDF → limited-read warning, no “great shape”.
3. Convert prospect → case at `new_client`, tasks assigned, welcome email link opens `/portal/onboarding/:token`.
4. Prospect email completes `/register` pay → onboarding + case (not duplicate-account 409).
5. Move case to `docs_ready` (admin drag or CRC) → `docs_ready` reminder flow runs; label-gated flows skip clients missing required labels.

## Affiliates

- **Feature flag:** `AFFILIATES_ENABLED=0|false` (server only) locks **Affiliates** + **My Affiliate** in the admin nav (same lock icon as Conversations), blocks `/admin/affiliates` + `/admin/affiliate` routes, returns `503 AFFILIATES_DISABLED` from affiliate APIs, and disables public `/r/:slug`. The API merges this into `section_locks` for the UI. Set to `1` when subscription pricing is ready. Super admins cannot unlock via section_locks while the FF is off.
- **Role:** `admins.role = 'affiliate'` — a restricted admin login scoped to their own referrals. `AdminLayout` nav for this role shows only Dashboard, Pipeline, Clients, and **My Affiliate** (`/admin/affiliate`); everything else (Documents, Payments, Tradelines, Subscriptions, Calendar, Tasks, Conversations, Tickets, Templates, Videos, Reminder Flows, Reports, Settings, People) is hidden. Managers (`super_admin`/`admin`) get an **Affiliates** nav item (`/admin/affiliates`) that affiliates cannot see.
- **Plans:** `standard` (referrer), `master` (can invite `sub_affiliate`s and earns an override commission on their referrals), `sub_affiliate` (reports to a `parent_affiliate_id`).
- **Links:** every affiliate gets short links via `/r/:slug` (`AffiliateRedirect`) that resolve the slug, log a click, and redirect to their `default_landing` (`credit_analysis` | `pricing`) — plus direct `?ref=` variants straight to `/credit-analysis` or `/pricing`.
- **Attribution:** client-side first-touch, 30-day window (`AFFILIATE_ATTRIBUTION_DAYS`, `client/lib/affiliateAttribution.ts`) — stored in a cookie + localStorage. The _first_ affiliate link a visitor clicks gets credit even if they return later without the `?ref=`/`/r/:slug` link, up to 30 days. Captured on the homepage, `/pricing`, `/credit-analysis`, `/register`, and any `/r/:slug` visit; sent to the API as `affiliateCode` on lead + registration submissions.
- **Portal access:** gated by `has_portal_access` (active or `comped` subscription). Ungated affiliates see a paywall card (Accept.js via reusable `AcceptCardFields`) or can be comped by a manager (no card) from the admin Affiliates detail sheet.
- **Commissions:** `enrollment` (on a referred client's payment), `override` (master's cut of a sub-affiliate's enrollment), or `manual`; lifecycle `pending → approved → paid` (or `void`). Managers mark status from the admin detail sheet; affiliates see a read-only commissions table in their portal.

6. Pipeline case cards show client labels; Clients page label filter works.

## Admin Work Hub (My Tasks)

- **Route:** `/admin/my-tasks` (nav **My Tasks**). Onboarding templates live at `/admin/tasks` as **Client Tasks**.
- **Board:** Kanban — Backlog / Doing / Done. Cards show source badge (`Optimum` | `HubSpot`), priority chip, due date, assignee (or Unassigned).
- **DnD:** Native HTML5 drag (same pattern as Pipeline) — no extra DnD library.
- **HubSpot:** Optional extract. Until OAuth env is set, header shows a locked “HubSpot sync · Soon” control (no connect). When configured: super admin grants permission; each permitted admin connects via OAuth. Soft sync on visit + Sync now; linked card edits push back.
- **i18n:** All chrome under `myTasks.*` / `clientTasksPage.*` / `adminNav.myTasks|clientTasks` (EN + ES).
