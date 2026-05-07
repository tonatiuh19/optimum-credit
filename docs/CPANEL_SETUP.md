# cPanel Setup Guide — Optimum Credit

This guide covers deploying the app and configuring the cron job that drives
**Reminder Flow** delayed emails via cPanel.

---

## 1. Environment Variables

In cPanel there are two ways to set environment variables depending on how the
app is hosted:

### Option A — Node.js App (cPanel Node.js Selector)

1. Log in to **cPanel** → **Software** → **Setup Node.js App**.
2. Open your application.
3. Click **Environment Variables** (or "Edit").
4. Add each key/value pair from the table below.
5. Click **Save** and then **Restart**.

### Option B — `.env` file on the server

If you deploy via SSH / Git, upload a `.env` file to the project root.  
Use `.env.example` as the template — copy it and fill in real values:

```bash
cp .env.example .env
nano .env   # fill in real values
```

### Required environment variables

| Variable                         | Description                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `PUBLIC_APP_URL`                 | Full URL of your site, e.g. `https://yourdomain.com`            |
| `JWT_SECRET`                     | Long random secret for auth token signing                       |
| `DB_HOST`                        | TiDB / MySQL host                                               |
| `DB_PORT`                        | Database port (TiDB default: `4000`)                            |
| `DB_USER`                        | Database username                                               |
| `DB_PASSWORD`                    | Database password                                               |
| `DB_NAME`                        | Database name                                                   |
| `DB_SSL`                         | `true` for TiDB Cloud                                           |
| `RESEND_API_KEY`                 | Resend.com API key for outgoing email                           |
| `SMTP_FROM`                      | Sender address, e.g. `Optimum Credit <no-reply@yourdomain.com>` |
| `AUTHORIZENET_API_LOGIN_ID`      | Authorize.net API Login ID                                      |
| `AUTHORIZENET_TRANSACTION_KEY`   | Authorize.net Transaction Key                                   |
| `AUTHORIZENET_SANDBOX`           | `false` in production                                           |
| `VITE_AUTHORIZENET_API_LOGIN_ID` | Same as above (client-side)                                     |
| `VITE_AUTHORIZENET_CLIENT_KEY`   | Authorize.net Client Key                                        |
| `VITE_AUTHORIZENET_SANDBOX`      | `false` in production                                           |
| `DOC_ENCRYPTION_KEY`             | 32-byte hex key for document encryption                         |
| **`CRON_SECRET`**                | **Secret token for the cron endpoint (see Section 2)**          |

To generate secure random values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Cron Job — Notification Queue Processor

The Reminder Flows system schedules delayed emails into the `notification_queue`
table. A cron job must run periodically to pick up pending rows and send them.

### How it works

- **Endpoint:** `POST /api/cron/process-queue`
- **Auth:** `x-cron-secret` header must match `CRON_SECRET` in `.env`
- **Batch size:** 50 emails per run, max 3 retry attempts before marking failed
- **Returns:** `{ ok: true, processed: N, sent: N, failed: N }`

### Setting up in cPanel

1. Log in to **cPanel** → **Advanced** → **Cron Jobs**.

2. Choose frequency — **every 5 minutes** is recommended:

   | Field   | Value |
   | ------- | ----- |
   | Minute  | `*/5` |
   | Hour    | `*`   |
   | Day     | `*`   |
   | Month   | `*`   |
   | Weekday | `*`   |

3. Paste this as the **Command** (replace values with your real domain and secret):

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://yourdomain.com/api/cron/process-queue \
  -H "x-cron-secret: YOUR_CRON_SECRET_VALUE" \
  >> /home/youraccount/logs/cron-queue.log 2>&1
```

> **Tip:** The `-o /dev/null -w "%{http_code}"` pattern logs just the HTTP status
> code to the log file (e.g. `200`) so you can spot failures without storing email HTML.

4. To also log the JSON response body (useful while debugging):

```bash
curl -s \
  -X POST https://yourdomain.com/api/cron/process-queue \
  -H "x-cron-secret: YOUR_CRON_SECRET_VALUE" \
  >> /home/youraccount/logs/cron-queue.log 2>&1
```

5. Click **Add New Cron Job**.

### Verifying it works

Manually trigger a test run from the server terminal:

```bash
curl -v -X POST https://yourdomain.com/api/cron/process-queue \
  -H "x-cron-secret: YOUR_CRON_SECRET_VALUE"
```

Expected response when there's nothing queued:

```json
{ "ok": true, "processed": 0, "sent": 0, "failed": 0 }
```

### Viewing failed notifications

In the database, check for failed rows:

```sql
SELECT id, client_id, channel, subject, scheduled_for, attempts, error_message
FROM notification_queue
WHERE status = 'failed'
ORDER BY scheduled_for DESC
LIMIT 20;
```

To retry failed items (resets status to pending):

```sql
UPDATE notification_queue SET status='pending', attempts=0 WHERE status='failed';
```

---

## 3. Node.js App Restart After Deploy

After uploading new code, restart the Node.js app in cPanel:

1. **cPanel → Setup Node.js App** → click **Restart** on your app.

Or via SSH:

```bash
cd /home/youraccount/public_html
npm install --production
npm run build
# Then restart via cPanel UI or your process manager (PM2, etc.)
```
