# OFG Report Wizard — Audit & Scenario Matrix (Jul 2026)

Deep hardening pass: validation guards, DB transactions, heuristic extraction core, wizard-only UI, and automated edge-case tests.

## Fixes applied (this pass)

| Area | Change |
|------|--------|
| **Manual PDF upload UI** | Removed from admin Reports tab; wizard is the only create path |
| **Legacy API bypass** | `POST /round-reports` and manual PDF upload return **410 Gone** |
| **`uploadRoundReportPdf` Redux thunk** | Removed (unused) |
| **Publish pipeline stage** | Round N report → `round_{N+1}` (Round 5 → `completed`) |
| **Finalize atomicity** | MySQL transaction wraps report row, PDF row, session, audit log, pipeline advance |
| **CDN orphan cleanup** | Best-effort `deleteFromCDN` on finalize failure when `CDN_DELETE_URL` is set |
| **Concurrent publish** | Optimistic lock: `UPDATE … WHERE status = 'review'` |
| **Duplicate publish** | Blocks second wizard publish for same client + round |
| **Round vs pipeline** | Validates round against case `pipeline_stage` on create + finalize |
| **PDF validation** | Magic bytes `%PDF`, 15MB cap, empty/scanned PDF detection |
| **Compliance** | Requires after scores; flags 150+ pt drops; middle score vs bureau median check |
| **Extraction core** | Provider-aware score parsing (IdentityIQ/SmartCredit/MyScoreIQ + TU/EX/EQ abbrev) |
| **Draft resume** | `GET /cases/{id}/report-wizard/sessions` + admin UI resume banner |
| **CRC stage ownership** | `CRC_SYNC_STAGES=false` — wizard owns pipeline; CRC inbound webhooks ignored |
| **Vercel timeout** | `maxDuration: 60` on `api/index.ts` |
| **Tests** | 34 vitest scenarios (`npm test`) |

---

## Scenario matrix

### Upload & extraction

| Scenario | Expected behavior | Status |
|----------|-------------------|--------|
| Missing before/after file | 400 Both required | Guarded |
| Non-PDF file / wrong magic bytes | 400 Invalid PDF | Guarded |
| File > 15MB | 400 size error | Guarded |
| Image-only/scanned PDF (no text) | 500 extraction error | Guarded |
| IdentityIQ score layout | Provider parser extracts TU/EX/EQ | Tested |
| Generic layout fallback | Regex score extraction | Tested |
| Re-extract while extracting | 409 already in progress | Guarded |
| Re-extract published session | 400 blocked | Guarded |

### Round & pipeline

| Scenario | Expected behavior | Status |
|----------|-------------------|--------|
| Publish Round 1 at `docs_ready` | Allowed → stage `round_2` | Tested |
| Publish Round 2 at `docs_ready` | 422 not available | Tested |
| Publish Round 3 at `round_2` | 422 not available | Tested |
| Publish Round 3 at `round_3` | Allowed → `round_4` | Tested |
| Publish Round 5 | Stage → `completed` | Tested |
| Second wizard publish same round | 409 duplicate | Guarded |
| Client at `new_client` | 422 cannot publish | Tested |

### Review & compliance

| Scenario | Expected behavior | Status |
|----------|-------------------|--------|
| Publish with zero after scores | 422 compliance | Tested |
| Bureau score > 850 or < 300 | 422 compliance | Tested |
| Score drop > 150 pts | 422 compliance | Tested |
| Middle score ≠ bureau median (>5) | 422 compliance | Tested |
| Guarantee language in wins | 422 compliance | Tested |
| Invalid tradeline code | 422 compliance | Tested |
| Missing CROA disclosure | 422 compliance | Tested |
| Finalize from `failed` | 400 not ready | Guarded |
| Double-click publish | 409 lock | Guarded |

### Data integrity

| Scenario | Expected behavior | Status |
|----------|-------------------|--------|
| Finalize DB failure after CDN upload | Session → `failed`, DB rolled back, CDN delete attempted | Transaction + cleanup |
| Partial email failure | Report still published (email best-effort) | By design |
| Wins diff case sensitivity | Case-insensitive match | Tested |
| `items_disputed` column | Stores **targets remaining** count (legacy column name) | Documented |

---

## Remaining known gaps

1. **Provider parsers** — Heuristics improved; real IdentityIQ/SmartCredit PDF samples still needed to tune further.
2. **CDN delete API** — Optional `CDN_DELETE_URL`; without it, orphan blobs may remain if DB fails after upload.
3. **Production env** — Set `CRC_SYNC_STAGES=false` and `CDN_DELETE_URL` on Vercel (local `.env` updated).

---

## Running tests

```bash
npm test          # 34 scenario tests
npm run typecheck
```

---

## Architecture (hardened)

All API logic — routes, validation, extraction, compliance, PDF generation — lives **inline in `api/index.ts`** per AGENTS.md (Vercel serverless).

```
Upload → validate PDF pair → validate round/stage
      → pdf-parse → provider heuristics → review UI
      → compliance → preview → finalize (lock + transaction)
      → notify client (post-commit)
```

No external AI. Human attestation required before preview/publish.
