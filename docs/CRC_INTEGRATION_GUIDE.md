# Credit Repair Cloud (CRC) Integration Guide

**Production app:** https://optimum-credit.vercel.app  
**CRC app:** https://app.creditrepaircloud.com

---

## Overview

This integration keeps Optimum Credit and Credit Repair Cloud in sync automatically:

| Direction         | What happens                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Optimum → CRC** | When a client pays, they are pushed to CRC as a new lead/client (`insertRecord`)                              |
| **Optimum → CRC** | When a client's pipeline stage changes in the admin panel, CRC is updated (`updateRecord`)                    |
| **CRC → Optimum** | When a team member advances a round in CRC, Zapier calls our webhook which updates the local `pipeline_stage` |

### Pipeline Stage Mapping

| CRC Column (GoHighLevel stage) | Optimum `pipeline_stage` |
| ------------------------------ | ------------------------ |
| New Client                     | `new_client`             |
| Docs Ready                     | `docs_ready`             |
| Round 1 (Month 1)              | `round_1`                |
| Round 2 (Month 2)              | `round_2`                |
| Round 3 (Month 3)              | `round_3`                |
| Round 4 (Month 4)              | `round_4`                |
| Round 5 (Month 5)              | `round_5`                |
| Completed                      | `completed`              |

---

## Step 1 — Get Your CRC API Credentials

1. Log in to [app.creditrepaircloud.com](https://app.creditrepaircloud.com)
2. Go to **API & Automations → API Credentials**
3. Copy your **API Auth Key** and **Secret Key**
4. Set them in `.env`:

```env
CRC_API_AUTH_KEY=your_api_auth_key_here
CRC_SECRET_KEY=your_secret_key_here
CRC_WEBHOOK_SECRET=pick_any_random_string   # e.g. openssl rand -hex 32
CRC_DRY_RUN=                                # leave empty to go live (set "true" for testing)
```

5. Restart the server after changing `.env`.

---

## Step 2 — Verify Configuration

```bash
curl -H "Authorization: Bearer <admin_token>" \
  https://optimum-credit.vercel.app/api/admin/crc/status
```

Expected response when live:

```json
{ "configured": true, "dry_run": false, "mode": "live" }
```

Expected response in dry-run (keys not set or `CRC_DRY_RUN=true`):

```json
{ "configured": false, "dry_run": false, "mode": "disabled" }
```

---

## Step 3 — Test Outbound Sync (Optimum → CRC)

### 3a. Preview XML for any client (no network call, no side effects)

```bash
curl -H "Authorization: Bearer <admin_token>" \
  https://optimum-credit.vercel.app/api/admin/crc/preview/42
```

Returns the exact XML that would be sent and which endpoint (`insertRecord` vs `updateRecord`) would be used:

```json
{
  "action": "insertRecord",
  "endpoint": "https://app.creditrepaircloud.com/api/lead/insertRecord",
  "crc_client_id": null,
  "crc_synced_at": null,
  "xmlData": "<crcloud>\n  <lead>\n    <type>Client</type>\n    ...",
  "note": "This is a preview only — nothing was sent to CRC."
}
```

### 3b. Manually push a client to CRC

```bash
curl -X POST \
  -H "Authorization: Bearer <admin_token>" \
  https://optimum-credit.vercel.app/api/admin/clients/42/crc-sync
```

Response:

```json
{
  "ok": true,
  "crc_client_id": "ODY4",
  "crc_synced_at": "2026-05-12T14:30:00.000Z"
}
```

After this, the client will appear in CRC under **Leads → Clients**.

### 3c. View sync audit log

```bash
curl -H "Authorization: Bearer <admin_token>" \
  "https://optimum-credit.vercel.app/api/admin/crc/sync-log?limit=20"
```

Each entry shows the action, result (`success` / `error`), and the XML payload for debugging.

---

## Step 4 — Test Inbound Webhook (CRC → Optimum)

### 4a. Simulate a stage change locally (no Zapier needed)

Use the admin simulate endpoint to fire the webhook handler with any stage name:

```bash
curl -X POST \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{ "clientId": 42, "stage": "Round 2 (Month 2)" }' \
  https://optimum-credit.vercel.app/api/admin/crc/simulate-webhook
```

Response:

```json
{
  "simulated": true,
  "webhook_response": {
    "ok": true,
    "stage": "round_2",
    "clientId": 42
  }
}
```

### 4b. Call the webhook directly (as Zapier would)

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your_CRC_WEBHOOK_SECRET",
    "email": "client@example.com",
    "stage": "Round 3 (Month 3)"
  }' \
  https://optimum-credit.vercel.app/api/webhooks/crc
```

Or use `crc_client_id` (the base64 ID from CRC) instead of email:

```bash
-d '{
  "secret": "your_CRC_WEBHOOK_SECRET",
  "crc_client_id": "ODY4",
  "stage": "Completed"
}'
```

**All accepted stage names** (case-insensitive):

- `New Client`
- `Docs Ready`
- `Round 1` or `Round 1 (Month 1)`
- `Round 2` or `Round 2 (Month 2)`
- `Round 3` or `Round 3 (Month 3)`
- `Round 4` or `Round 4 (Month 4)`
- `Round 5` or `Round 5 (Month 5)`
- `Completed`

### Webhook Response Codes

| HTTP                                            | Meaning                                 |
| ----------------------------------------------- | --------------------------------------- |
| `200 { ok: true, stage, clientId }`             | Stage updated successfully              |
| `200 { ok: true, unchanged: true }`             | Client already on that stage            |
| `200 { ok: false, reason: "client_not_found" }` | No matching client — Zapier won't retry |
| `400`                                           | Missing `stage` or identity field       |
| `401`                                           | Wrong `secret`                          |
| `422`                                           | Stage name not recognized               |

---

## Step 5 — Set Up Zapier

### Zap 1: CRC Round Change → Update Optimum Pipeline Stage

This is the main integration. Whenever your team advances a round in Credit Repair Cloud, Zapier notifies Optimum Credit.

**Trigger:**

- App: **Credit Repair Cloud**
- Event: **Client Stage Changed** (or use a Zapier webhook trigger if CRC doesn't have a native trigger — use the CRC webhook/Zapier webhook integration)

**Action:**

- App: **Webhooks by Zapier**
- Event: **POST**
- URL: `https://optimum-credit.vercel.app/api/webhooks/crc`
- Payload type: `JSON`
- Data:

```
secret    → your_CRC_WEBHOOK_SECRET
email     → {{email}}          (the client's email from CRC)
stage     → {{stage_name}}     (the new stage name, e.g. "Round 2 (Month 2)")
```

> **Tip:** If CRC provides a client ID field, also map `crc_client_id → {{client_id}}` as a fallback lookup.

**Test the Zap** using a real client record in CRC, advance the round, and verify the pipeline stage updates in the Optimum Credit admin panel.

---

### Zap 2 (Optional): New CRC Client → Push to Optimum

Only needed if clients are sometimes added directly in CRC rather than through the Optimum registration form.

**Trigger:** Credit Repair Cloud → New Client

**Action:** Webhooks by Zapier → POST  
**URL:** `https://optimum-credit.vercel.app/api/webhooks/crc`

```
secret  → your_CRC_WEBHOOK_SECRET
email   → {{email}}
stage   → New Client
```

---

## Step 6 — What Happens Automatically (No Config Needed)

These are already wired and fire without any Zapier setup:

| Event                                       | What fires                                                  |
| ------------------------------------------- | ----------------------------------------------------------- |
| Client completes registration & payment     | `crcSyncClient()` pushes to CRC as `insertRecord`           |
| Admin changes pipeline stage in admin panel | `crcSyncClient()` updates CRC as `updateRecord`             |
| Webhook receives a stage change             | `pipeline_stage` updated locally + logged in `crc_sync_log` |
| Stage advances to `completed`               | `reminder_flow` triggered automatically                     |

---

## Database Tables Added

### `clients` table — new columns

| Column          | Type          | Description                                 |
| --------------- | ------------- | ------------------------------------------- |
| `crc_client_id` | `VARCHAR(64)` | Base64 CRC ID returned after `insertRecord` |
| `crc_synced_at` | `DATETIME`    | Timestamp of last successful CRC push       |

### `crc_sync_log` table

Full audit trail of every CRC operation. Columns:

| Column           | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `action`         | `push_create`, `push_update`, `pull`, `webhook_stage_update` |
| `crc_client_id`  | CRC ID involved                                              |
| `pipeline_stage` | Stage at time of sync                                        |
| `status`         | `success` or `error`                                         |
| `error_message`  | Error detail if failed                                       |
| `payload`        | Full XML + response JSON for debugging                       |

---

## Troubleshooting

**CRC sync returns error:**

```bash
# Check the last sync log entries
curl -H "Authorization: Bearer <admin_token>" \
  "https://optimum-credit.vercel.app/api/admin/crc/sync-log?limit=5"
```

The `payload` field contains the exact XML sent and the CRC response.

**Stage not updating from webhook:**

- Verify `secret` matches `CRC_WEBHOOK_SECRET` in `.env`
- Confirm the `stage` value is one of the accepted names (case-insensitive)
- Check that the client's `email` in CRC matches exactly what's in Optimum

**Client pushed to CRC but no `crc_client_id` stored:**

- CRC dry-run mode is on — check `CRC_DRY_RUN` in `.env`
- The `insertRecord` response didn't include an `id` — check the sync log `payload`

**`CRC_DRY_RUN` mode** (safe for dev):

- All CRC calls are logged to server console, nothing hits the API
- Full code path runs — DB writes, sync log entries, timestamp updates
- Set `CRC_DRY_RUN=true` in `.env` to enable

---

## Local Dev Quick Start

```bash
# 1. Enable dry-run (already set by default in .env)
CRC_DRY_RUN=true

# 2. Start the dev server
npm run dev

# 3. Get an admin token (sign in via the admin panel)

# 4. Check status
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/admin/crc/status

# 5. Preview a client's XML
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/admin/crc/preview/1

# 6. Simulate a webhook stage change
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clientId": 1, "stage": "Round 1 (Month 1)"}' \
  http://localhost:8080/api/admin/crc/simulate-webhook

# 7. Check the sync log
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/admin/crc/sync-log
```
