# OFG Progress Report Wizard — Deep Audit & Implementation Proposal

**Project:** Optimum Credit Platform  
**Feature:** Admin wizard to ingest 2 credit-report PDFs, extract structured data, generate branded OFG Progress Reports, and sync pipeline rounds (admin Kanban + client portal)  
**Reference docs:** `OFG Team Setup Guide Jun2026.pdf`, `OFG Progress Report Project Knowledge v2.pdf`  
**Date:** July 4, 2026  
**Status:** Proposal — not yet implemented

---

## 1. Executive Summary

Today, OFG progress reports are produced **manually outside the app** (Claude Projects + human review + PDF upload). Optimum Credit already has **pipeline rounds**, **round report storage**, **client portal display**, and **CRC client sync** — but **no PDF parsing**, **no report generation**, and **no wizard**.

This proposal defines a **robust, in-app OFG Progress Report Wizard** that:

1. Accepts **two PDFs** per round (BEFORE enrollment report + AFTER/current report).
2. **Extracts** bureau scores, tradelines, removals, utilization, and targets.
3. Presents a **human review step** before anything is committed (compliance-critical).
4. **Generates** the branded 3-page OFG PDF (scores, wins, utilization, roadmap, CROA).
5. **Persists** structured round data + PDF to existing tables.
6. **Advances** the case on the admin Pipeline Kanban and client portal progress UI.
7. **Notifies** the client (email/SMS/reminder flows — already wired).
8. **Syncs CRC** only for client creation + optional stage push (CRC is no longer the report source of truth).

**Recommendation:** Build in **4 phases** over ~6–8 weeks. Fix existing pipeline sync bugs in **Phase 0** before layering the wizard on top.

---

## 2. What OFG Requires (from Project Knowledge v2)

The external OFG workflow (Claude Project) defines the **contract** our wizard must replicate:

### 2.1 Inputs (every report run)

| Input | Required | Notes |
|-------|----------|-------|
| BEFORE credit report PDF | Yes | Enrollment baseline; all 3 bureaus |
| AFTER / current credit report PDF | Yes | Most recent pull; all 3 bureaus |
| Client first name | Yes | Pre-filled from case in our app |
| Specific wins to highlight | Optional | Admin checkbox / text |
| Spanish translation | Optional | `preferred_language === 'es'` or toggle |
| Tradeline recommendation | Optional | IH-coded only (never cardholder names) |
| Funding readiness note | Optional | Page 3 add-on |

### 2.2 Output — 3-page branded PDF (fixed order)

| Page | Content |
|------|---------|
| **Page 1** | Client name + dates; TU/EX/EQ before vs after + points gained; middle score; ASCII score bars; **Wins table** (removed items); **Round targets** (still on report) |
| **Page 2** | Utilization table (limit, balance, % used, pay-down to 30%/10%); positive accounts; high-utilization action items |
| **Page 3** | Round milestone timeline; score goal + gap; 3–5 step action plan (OFG vs client ownership); File Strength Score (0–100); **CROA disclosure** (mandatory) |

### 2.3 Brand & compliance (non-negotiable)

- **Colors:** Navy `#0D1F3C`, Gold `#C9A84C`
- **Tone:** Encouraging, results-focused, professional
- **Compliance:** Factual only; no goodwill letters; no payoff/debt negotiation advice; no score guarantees (use “projected” / “on track for”); tradeline refs as IH-1, IH-2 only; CROA on every report
- **Filename:** `{FirstName}_OFG_Progress_Report_{MonYear}.pdf` (e.g. `Maria_OFG_Progress_Report_Jun2026.pdf`)

### 2.3 Post-generation workflow (today manual → tomorrow in-app)

1. Admin reviews extracted vs source PDFs  
2. Client receives report (portal + optional email/SMS)  
3. Case advances to corresponding pipeline round  
4. ~~Save to HubSpot~~ (out of scope unless API added later)  
5. ~~Affiliate loop~~ (future; reminder flows exist)

---

## 3. Current System Audit

### 3.1 What already works ✅

| Capability | Location | Reuse for wizard |
|------------|----------|------------------|
| Pipeline Kanban (8 stages) | `client/pages/admin/Pipeline.tsx` | Display round after wizard completes |
| Client side panel | `client/components/admin/ClientPanelSheet.tsx` | **Primary wizard host** (Reports tab) |
| Round report DB | `client_round_reports`, `round_report_pdfs` | Store metrics + generated PDF |
| Encrypted PDF storage | `api/index.ts` → CDN + AES-256-GCM | Store before/after source PDFs + output |
| Client portal reports | `client/pages/client/Reports.tsx` | Show scores, deltas, PDF download |
| Client dashboard progress | `client/pages/client/Dashboard.tsx` | Pipeline bar reflects round |
| Email/SMS on round complete | `POST /api/admin/clients/:id/round-reports` | Trigger after wizard finalize |
| Reminder flows | `round_N_complete` triggers | Already mapped |
| CRC client push | `crcSyncClient()` on payment + stage change | Keep for client creation only |
| Multi-step UI pattern | `Register.tsx` | Wizard step UX reference |
| Task gating → Docs Verified | `client_task_completions` | Unchanged; wizard runs after docs |

### 3.2 What is missing ❌

| Gap | Impact |
|-----|--------|
| **No PDF text extraction** | Cannot automate score/item parsing |
| **No structured credit item model** | Only `score_before`, `score_after`, `items_removed`, `items_disputed` |
| **No report PDF generation** | Admins upload finished PDFs manually |
| **No wizard UI** | No 2-PDF upload + review flow |
| **RoundReportForm dead code** | `ClientDetail.tsx` has Formik form never rendered |
| **Pipeline dual-write bug** | Kanban reads `credit_repair_cases`; round-report API updates `clients` only |
| **CRC webhook one-way** | Updates `clients` only, not cases |
| **`case_id` never set** on round reports | Reports not linked to active case |
| **super_admin gate** on report APIs | May need `admin` role for specialists |
| **No draft/session state** | Long extraction runs need resumable sessions |
| **No source PDF retention policy** | Before/after inputs not stored today |

### 3.3 Critical bugs to fix first (Phase 0)

These will cause **visible desync** once the wizard advances rounds:

```
POST /api/admin/clients/:id/round-reports
  → updates clients.pipeline_stage ONLY
  → Kanban reads credit_repair_cases.pipeline_stage → card stays in old column

POST /api/webhooks/crc
  → updates clients ONLY

POST /api/admin/clients/:id/stage (legacy)
  → updates clients ONLY
```

**Fix:** Introduce `advanceCasePipeline(clientId, caseId, newStage, adminId, notes)` helper that atomically:

1. Updates `credit_repair_cases.pipeline_stage` + `pipeline_stage_changed_at`
2. Updates `clients.pipeline_stage` + `pipeline_stage_changed_at`
3. Inserts `client_pipeline_history`
4. Calls `crcSyncClient()` async (non-blocking)
5. Returns unified result

Refactor **all** stage-advance paths to use this helper before wizard ships.

### 3.4 Current round report API (baseline)

```http
POST /api/admin/clients/:id/round-reports
Authorization: super_admin
Body: {
  round_number,        // 1–5
  score_before,        // single number (middle score today)
  score_after,
  items_removed,
  items_disputed,
  summary_md
}
```

**Limitations vs OFG spec:**

- No per-bureau scores (TU/EX/EQ)
- No wins table rows
- No utilization rows
- No file strength score
- No CROA block storage
- No link to source PDFs
- No generated output PDF (only manual upload endpoint exists)

### 3.5 CRC scope going forward

Per product direction: **CRC is only needed for client creation** (already on payment confirmation). Round progression and reports become **Optimum-native**.

| CRC action | Keep? | Notes |
|------------|-------|-------|
| `insertRecord` on payment | ✅ Yes | Existing `crcSyncClient` |
| `updateRecord` on stage change | ⚠️ Optional | Can disable after wizard is source of truth |
| Zapier webhook inbound | ⚠️ Optional | Risk of fighting wizard if both update stages |
| Report storage in CRC | ❌ No | Reports live in Optimum only |

**Recommendation:** Add `CRC_SYNC_STAGES=false` env flag; default off once wizard is live. Keep client creation sync.

---

## 4. Proposed Architecture

### 4.1 High-level flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ADMIN: Client Panel → Reports tab → "Generate OFG Report"              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — Upload & context                                              │
│  • Round number (auto: next round from case stage)                      │
│  • BEFORE PDF (enrollment baseline)                                     │
│  • AFTER PDF (current pull)                                             │
│  • Optional flags: highlight win, tradeline rec, funding note, Spanish  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — Extract (async job)                                           │
│  POST /api/admin/cases/:caseId/report-wizard/sessions                   │
│  → store encrypted source PDFs                                          │
│  → run extraction pipeline (pdf-parse + bureau heuristics + LLM assist) │
│  → persist draft structured JSON                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — Human review (mandatory)                                      │
│  Admin edits: scores, wins, targets, utilization, action plan           │
│  Side-by-side PDF preview (before/after)                                │
│  Compliance checklist auto-validated                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4 — Generate & publish                                            │
│  POST .../sessions/:id/finalize                                         │
│  → render 3-page OFG PDF (Puppeteer/HTML template or pdf-lib)           │
│  → UPSERT client_round_reports + round_report_pdfs                      │
│  → advanceCasePipeline(case → round_N)                                  │
│  → notify client (email/SMS/reminder)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         Admin Pipeline Kanban              Client /portal/reports
         card moves to Round N              scores + PDF download
```

### 4.2 Extraction strategy (robust, layered)

Credit report PDFs vary by provider (IdentityIQ, SmartCredit, MyScoreIQ, etc.). A single regex approach will fail.

**Recommended 3-layer pipeline:**

| Layer | Tool | Purpose |
|-------|------|---------|
| **L1 — Text extraction** | `pdf-parse` or `pdfjs-dist` | Raw text from both PDFs |
| **L2 — Provider detection + parsers** | Custom per-provider modules | Score blocks, tradeline tables, inquiry sections |
| **L3 — Deterministic merge** | pdf-parse + provider heuristics | Regex/scoring rules; admin review in wizard Step 3 |

**Why no LLM:** Report fields are structured (scores, account lines, before/after diff). Deterministic parsing + admin verification is sufficient and keeps all PDF text on-server without third-party AI.

**Safety controls:**

- Never auto-publish without admin review
- Store extraction confidence scores per field
- Flag low-confidence fields in red in review UI
- Log raw extraction + final approved values for audit

### 4.3 PDF generation strategy

**Recommended:** HTML → PDF via **Puppeteer** (or `@react-pdf/renderer` for simpler layout control without headless Chrome).

| Approach | Pros | Cons |
|----------|------|------|
| Puppeteer + HTML/CSS templates | Pixel-perfect OFG branding; easy 3-page layout | Heavier on Vercel (needs serverless chromium or external service) |
| `@react-pdf/renderer` | Pure Node; Vercel-friendly | Layout learning curve for complex tables |
| External service (DocRaptor, PDFShift) | Offloads compute | Cost + dependency |

**Recommendation for Vercel:** Use `@react-pdf/renderer` for v1 (no Chromium on serverless). If layout quality insufficient, move generation to a **background job** on a small worker (Railway/Fly) or Vercel Pro with `@sparticuz/chromium`.

Templates must encode:

- Navy/gold brand tokens (match `client/global.css` gold theme)
- ASCII score bars only (no Unicode block chars)
- CROA disclosure footer on page 3
- IH-coded tradeline section when enabled

---

## 5. Data Model (new tables + extensions)

### 5.1 New table: `report_wizard_sessions`

Tracks in-progress and completed wizard runs.

```sql
CREATE TABLE report_wizard_sessions (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id           INT UNSIGNED NOT NULL,
  client_id         INT UNSIGNED NOT NULL,
  round_number      TINYINT UNSIGNED NOT NULL,
  status            ENUM('draft','extracting','review','generating','published','failed') NOT NULL DEFAULT 'draft',
  before_pdf_id     INT UNSIGNED NULL,      -- FK → round_report_source_pdfs
  after_pdf_id      INT UNSIGNED NULL,
  options_json      JSON NULL,              -- { highlight_win, tradeline_rec, funding_note, spanish }
  extracted_json    JSON NULL,              -- full structured draft from pipeline
  reviewed_json     JSON NULL,              -- admin-edited final structured data
  extraction_meta   JSON NULL,              -- { provider, confidence, errors, duration_ms }
  output_pdf_id     INT UNSIGNED NULL,      -- FK → round_report_pdfs
  round_report_id   INT UNSIGNED NULL,      -- FK → client_round_reports
  created_by_admin_id INT UNSIGNED NOT NULL,
  published_at      DATETIME NULL,
  error_message     TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_rws_case (case_id),
  KEY idx_rws_client (client_id),
  KEY idx_rws_status (status),
  CONSTRAINT fk_rws_case FOREIGN KEY (case_id) REFERENCES credit_repair_cases(id),
  CONSTRAINT fk_rws_client FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

### 5.2 New table: `round_report_source_pdfs`

Stores BEFORE/AFTER input PDFs (encrypted, like existing uploads).

```sql
CREATE TABLE round_report_source_pdfs (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id        INT UNSIGNED NOT NULL,
  role              ENUM('before','after') NOT NULL,
  file_name         VARCHAR(255) NOT NULL,
  storage_key       TEXT NOT NULL,
  encrypted         TINYINT(1) NOT NULL DEFAULT 1,
  enc_iv            VARCHAR(32) NOT NULL,
  enc_tag           VARCHAR(32) NOT NULL,
  uploaded_by_admin_id INT UNSIGNED NOT NULL,
  uploaded_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rrsp_session FOREIGN KEY (session_id) REFERENCES report_wizard_sessions(id) ON DELETE CASCADE
);
```

### 5.3 Extend `client_round_reports`

Add structured OFG fields (JSON columns avoid wide schema churn):

```sql
ALTER TABLE client_round_reports
  ADD COLUMN case_id INT UNSIGNED NULL AFTER client_id,
  ADD COLUMN bureau_scores_json JSON NULL COMMENT 'TU/EX/EQ before+after+delta',
  ADD COLUMN wins_json JSON NULL COMMENT 'removed items table rows',
  ADD COLUMN targets_json JSON NULL COMMENT 'round 2+ targets still on report',
  ADD COLUMN utilization_json JSON NULL,
  ADD COLUMN action_plan_json JSON NULL,
  ADD COLUMN file_strength_score TINYINT UNSIGNED NULL,
  ADD COLUMN wizard_session_id INT UNSIGNED NULL,
  ADD COLUMN report_locale ENUM('en','es') NOT NULL DEFAULT 'en';
```

Keep existing scalar columns populated for backward compatibility:

- `score_before` / `score_after` → **middle score** (avg of 3 bureaus or lowest-middle per OFG convention — define in review step)
- `items_removed` → count of wins rows
- `items_disputed` → count of targets rows
- `summary_md` → markdown export of action plan for portal text view

### 5.4 Structured JSON schema (extracted/reviewed)

```typescript
interface OfGReportData {
  client: { firstName: string; lastName?: string };
  reportDate: { before: string; after: string }; // ISO dates
  bureauScores: {
    transunion: { before: number; after: number };
    experian:   { before: number; after: number };
    equifax:    { before: number; after: number };
  };
  middleScore: { before: number; after: number };
  wins: Array<{
    itemRemoved: string;
    bureaus: ("TU" | "EX" | "EQ")[];
    impact: string;
    status: string;
    highlighted?: boolean;
  }>;
  targets: Array<{
    item: string;
    bureaus: ("TU" | "EX" | "EQ")[];
    detail: string;
    priority: "high" | "medium" | "low";
  }>;
  utilization: Array<{
    account: string;
    limit: number;
    balance: number;
    pctUsed: number;
    payTo30: number;
    payTo10: number;
  }>;
  positiveAccounts: string[];
  actionNeeded: string[];
  roadmap: {
    currentRound: number;
    nextRound: number;
    scoreGoal: number;
    gapRemaining: number;
    milestones: string[];
  };
  actionPlan: Array<{
    step: number;
    description: string;
    owner: "ofg" | "client";
  }>;
  fileStrengthScore: number; // 0–100
  tradelineRecommendation?: { code: string; projectedImpact: string };
  fundingReadinessNote?: string;
  croaDisclosure: string; // fixed text, always present
}
```

---

## 6. API Design

All routes under `requireAdmin` (consider expanding from `requireSuperAdmin` for report specialists).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/admin/cases/:caseId/report-wizard/sessions` | Create session; upload 2 PDFs (multipart) |
| GET | `/api/admin/report-wizard/sessions/:id` | Poll extraction status + draft data |
| PATCH | `/api/admin/report-wizard/sessions/:id/review` | Save admin-edited `reviewed_json` |
| POST | `/api/admin/report-wizard/sessions/:id/extract` | Re-run extraction (if PDFs changed) |
| POST | `/api/admin/report-wizard/sessions/:id/finalize` | Generate PDF, publish report, advance pipeline |
| DELETE | `/api/admin/report-wizard/sessions/:id` | Cancel draft |
| GET | `/api/admin/report-wizard/sessions/:id/before-pdf` | Decrypted source preview |
| GET | `/api/admin/report-wizard/sessions/:id/after-pdf` | Decrypted source preview |

**Portal (read-only extensions):**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/portal/reports/:round/structured` | Optional rich report view (scores table, wins) |
| GET | `/api/portal/round-report-pdfs/:pdfId` | Existing download (unchanged) |

Update `swagger.yaml` + `shared/api.ts` for all new types.

---

## 7. UI/UX Proposal

### 7.1 Entry point

**Primary:** `ClientPanelSheet` → **Reports** tab → button **“Generate OFG Progress Report”**

Show when:

- Case is at `round_N` or completing round N (not `new_client` / `docs_ready` unless business allows baseline-only report)
- All required tasks approved (same gate as Docs Verified drag)

**Secondary:** Pipeline card context menu → “Generate report for this round”

### 7.2 Wizard steps (modal or full-screen drawer)

| Step | UI | Validation |
|------|-----|------------|
| **1. Upload** | 2 dropzones (Before / After); round selector; option toggles | Both PDFs required; max 15MB each |
| **2. Processing** | Progress spinner; “Extracting scores and tradelines…” | Poll session status |
| **3. Review** | Tabbed editor: Scores / Wins / Targets / Utilization / Roadmap | Required fields; compliance warnings |
| **4. Preview** | Embedded PDF preview of generated output | Admin must click “Confirm & Publish” |
| **5. Done** | Success + links to Pipeline + client portal | — |

Reuse patterns from `Register.tsx` (step state, animations) and `ClientPanelSheet` Reports tab (PDF upload).

### 7.3 Admin Pipeline visualization

No Kanban structural change needed. After finalize:

- Case card moves to `round_N` (or `completed` after round 5)
- Round column badge count updates via existing `fetchPipeline` refresh

### 7.4 Client portal visualization

**`/portal/reports`** — enhance existing cards:

| Current | Enhanced |
|---------|----------|
| Single score before/after | Per-bureau TU/EX/EQ table |
| `items_removed` count | Wins list (truncated + expand) |
| PDF download only | Inline summary + PDF download |
| — | File Strength Score badge |
| — | Round milestone timeline |

**`/portal` dashboard** — pipeline progress bar already reads `pipeline_stage`; no change needed once dual-write bug is fixed.

---

## 8. Compliance & Quality Gates

Automated checks before **Finalize** is enabled:

| Rule | Enforcement |
|------|-------------|
| CROA disclosure present | Hard-coded in template; cannot remove |
| No score guarantee language | NLP lint on free-text fields |
| No cardholder names in tradeline section | Regex block on `tradelineRecommendation` |
| Factual wins only | Admin attestation checkbox: “I verified against source PDFs” |
| ASCII bars only | Generator validates charset |

Store `compliance_acknowledged_at` + `compliance_acknowledged_by` on session row.

---

## 9. Implementation Phases

### Phase 0 — Foundation fixes (1 week)

- [ ] `advanceCasePipeline()` unified helper
- [ ] Refactor round-report POST, CRC webhook, legacy stage POST
- [ ] Populate `case_id` on `client_round_reports`
- [ ] Wire dead `RoundReportForm` OR remove in favor of wizard
- [ ] Add `CRC_SYNC_STAGES` env flag

### Phase 1 — Wizard shell + storage (1.5 weeks)

- [ ] DB migrations (sessions, source PDFs, extended columns)
- [ ] Session CRUD API + encrypted PDF upload
- [ ] Admin UI Steps 1–2 (upload + polling)
- [ ] Redux `reportWizardSlice`
- [ ] Swagger + shared types

### Phase 2 — Extraction pipeline (2 weeks)

- [ ] pdf-parse integration
- [ ] Provider detection (IdentityIQ, SmartCredit, generic)
- [ ] Provider-specific parser improvements (IdentityIQ, SmartCredit)
- [ ] Review UI Step 3 with confidence highlighting
- [ ] Unit tests with anonymized sample PDFs

### Phase 3 — PDF generation + publish (1.5 weeks)

- [ ] OFG HTML/React-PDF templates (3 pages, brand tokens)
- [ ] Finalize endpoint: generate → store → advance pipeline → notify
- [ ] Admin preview Step 4
- [ ] Client portal enhanced report cards

### Phase 4 — Hardening (1 week)

- [ ] Spanish template variant
- [ ] Re-extract + edit published report (super_admin only)
- [ ] Audit log entries
- [ ] Load testing on Vercel (PDF gen timeout handling)
- [ ] Runbook + admin training doc

**Total estimate:** 6–8 weeks (1 senior full-stack + QA on real PDF samples)

---

## 10. Technical Dependencies

| Package / Service | Purpose |
|-------------------|---------|
| `pdf-parse` or `pdfjs-dist` | Text extraction |
| `pdf-parse` | Text extraction |
| `@react-pdf/renderer` | PDF generation v1 |
| Existing CDN + AES encryption | File storage |
| Existing email + Twilio | Notifications |

**New env vars:**

```env
REPORT_WIZARD_MAX_PDF_MB=15
CRC_SYNC_STAGES=false          # after wizard live
```

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PDF format variance breaks parser | High | LLM fallback + mandatory human review |
| Vercel function timeout on generate | Medium | Async job queue or external worker |
| Pipeline desync | High (today) | Phase 0 fix before wizard |
| Compliance violation in free text | Medium | Lint + attestation + fixed CROA block |
| CRC webhook fights wizard stage | Medium | Disable inbound stage sync |
| Large PDF memory on serverless | Medium | Stream to CDN; don't hold both in memory long |

---

## 12. Success Criteria

1. Admin completes wizard in **< 10 minutes** (vs ~30+ min manual Claude flow).
2. **100%** of published reports include CROA disclosure and ASCII score bars.
3. Pipeline card and client portal show **same round** after publish.
4. Client receives email/SMS within **60 seconds** of publish.
5. Generated PDF matches OFG layout spec on **3 sample clients** signed off by operations.
6. Extraction accuracy: **≥ 95%** bureau scores without manual edit on IdentityIQ/SmartCredit samples.

---

## 13. Out of Scope (v1)

- HubSpot file sync
- Affiliate auto-forward
- Automatic BEFORE PDF from enrollment (admin still uploads unless we link to stored enrollment pull later)
- Mobile admin wizard (desktop-first; responsive read-only on tablet)
- Client self-service report generation
- Replacing CRC client creation (keep existing payment hook)

---

## 14. Immediate Next Steps

1. **Stakeholder sign-off** on this proposal (especially LLM-assisted extraction + CRC stage sync disable).
2. **Collect 5–10 anonymized real BEFORE/AFTER PDF pairs** from operations for parser development.
3. **Execute Phase 0** pipeline sync refactor (low risk, high value).
4. **Spike:** `@react-pdf/renderer` 3-page OFG mock with sample data (1–2 days).
5. **Spike:** pdf-parse + Claude extraction on 2 sample PDFs; measure accuracy.

---

## Appendix A — File Map (implementation touchpoints)

| Area | Files |
|------|-------|
| Wizard UI | `client/components/admin/OfgReportWizard.tsx` (new), `ClientPanelSheet.tsx` |
| Redux | `client/store/slices/reportWizardSlice.ts` (new) |
| API | `api/index.ts` (wizard routes inline for Vercel serverless) |
| PDF templates | `api/templates/ofgProgressReport/` (new) |
| Extraction | `api/services/reportExtraction/` (new) |
| Migrations | `database/migrations/YYYYMMDD_report_wizard.sql` |
| Types | `shared/api.ts` |
| Docs | `docs/OFG_PROGRESS_REPORT_WIZARD_PROPOSAL.md` (this file) |
| Portal UI | `client/pages/client/Reports.tsx` |

## Appendix B — Mapping OFG pages → DB → Portal

| OFG PDF section | JSON field | Portal display |
|-----------------|------------|----------------|
| Score comparison table | `bureau_scores_json` | Reports card header |
| Wins table | `wins_json` | Expandable list |
| Round targets | `targets_json` | “Still working on” section |
| Utilization | `utilization_json` | Optional detail tab |
| Action plan | `action_plan_json` | Summary bullets |
| File Strength | `file_strength_score` | Badge |
| Full PDF | `round_report_pdfs` row | Download button |

---

## Implementation Status (Jul 2026)

**v1 shipped locally.** Remaining ops: run `npm run db:migrate` on production TiDB and redeploy Vercel with `CRC_SYNC_STAGES` as needed.

| Item | Status |
|------|--------|
| `advanceCasePipeline()` helper | Done |
| Round-report POST + CRC webhook use helper | Done |
| Legacy `POST /cases/:id/stage` + `POST /clients/:id/stage` refactored | Done |
| `case_id` on `client_round_reports` | Done |
| `RoundReportForm` removed (wizard replaces it) | Done |
| `CRC_SYNC_STAGES` env flag | Done |
| DB migrations (sessions, source PDFs, extended columns) | Done |
| Session CRUD + encrypted PDF upload | Done |
| Admin wizard UI (upload → extract → review → preview → publish) | Done |
| Redux `reportWizardSlice` (+ re-extract, preview thunks) | Done |
| Swagger + shared types | Done |
| pdf-parse extraction + provider detection | Done |
| Deterministic extraction (pdf-parse + heuristics, no LLM) | Done |
| Review UI confidence flags + wins/targets editing | Done |
| Compliance validation gate on preview/finalize | Done |
| Audit log on publish | Done |
| 3-page PDF via pdf-lib (EN + ES labels) | Done |
| Portal wins/targets on Reports page | Done |
| Re-extract endpoint | Done |
| Preview endpoint (non-persisted PDF) | Done |

### Phase 4 (deferred)

- Edit published report (super_admin only)
- Load testing / Vercel timeout hardening
- Admin training runbook

See also: [`docs/OFG_REPORT_WIZARD_AUDIT.md`](./OFG_REPORT_WIZARD_AUDIT.md) for gap analysis and fixes.

---

*Prepared for Optimum Credit / OFG operations. Aligns with OFG Progress Report Project Knowledge v2 and Team Setup Guide (Jun 2026).*
