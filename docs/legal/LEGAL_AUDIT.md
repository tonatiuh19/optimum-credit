# Legal Links Audit — Terms & Privacy / SMS

## Runtime source of truth

Markdown lives in the **`legal_documents`** table (not hardcoded in the UI).

| Slug | Public page | Edit |
|---|---|---|
| `terms` | `/legal/terms` | Admin → Settings → Legal Documents |
| `privacy` | `/legal/privacy` | Same (currently SMS messaging terms content) |

API:

- `GET /api/legal` — summaries
- `GET /api/legal/:slug` — full `content_md`
- `GET /api/admin/legal` + `PUT /api/admin/legal/:slug` — super admin

UI loads via Redux (`legalSlice`) with a skeleton on `/legal/:slug`.

## Seed / reference copies

- [`TERMS_AND_CONDITIONS.md`](./TERMS_AND_CONDITIONS.md)
- [`SMS_MESSAGING_TERMS.md`](./SMS_MESSAGING_TERMS.md)
- Migration: `database/migrations/20260717_120000_legal_documents.sql`

> **Note:** The `privacy` slug was seeded from the SMS terms URL you provided. Replace `content_md` in Admin Settings when you have a real privacy policy.
