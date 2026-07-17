# Report Wizard — Test Coverage & Gaps

## Suite (vitest)

| File | Focus |
|---|---|
| `api/reportWizardValidation.test.ts` | PDF magic/size, round publish rules, session guards, middle score |
| `api/reportWizardScenarios.test.ts` | Provider detect, score extract, diff, confidence, compliance basics |
| `api/reportWizardEdgeCases.test.ts` | Edge/gap hunt: boundaries, swapped PDFs, Alex-style score drops, join scenario |
| `api/legalMarkdownSanitize.test.ts` | Public MD sanitize (meta/H1 strip) |

**106 tests** as of this pass.

## Gaps found / fixed while testing

1. **Soft vs hard compliance** — >150 pt bureau drop was hard-blocking preview; now warning-only for preview, ack required on publish.
2. **pdf-parse v2 API** — exports `PDFParse` class, not a default function.
3. **PDF size error message** — always said “15 MB” even with custom `maxBytes`; now uses computed MB.
4. **Mis-upload risk** — uploading an OFG progress PDF as “before/after” can invent weird scores; extraction tests cover OFG-like text; UI should keep score-anomaly banner.

## Still not covered (follow-ups)

- Full PDF I/O through `extractFromCreditReportPdfs` (needs fixture PDFs + pdf-parse worker in CI)
- HTTP route integration (auth, multer, session status transitions) — needs API test harness / supertest
- Frontend Formik/checkbox ack flows (component tests)
- Concurrent finalize race (`generating` lock) — needs DB integration test
