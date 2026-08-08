# HubSpot — Optimum My Tasks

## Auth model (2026.03)

HubSpot Developer Support (Aug 2026): **Tasks API does not use**
`crm.objects.tasks.*` scopes on the 2026.03 platform. Those strings are invalid
in Projects / Service Keys.

Tasks endpoints (`/crm/objects/2026-03/tasks`) are authorized with:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- (+ `oauth` for Projects OAuth apps)

## Option A — Service Key (simplest for OFG)

1. Development → **Keys** → **Service keys** → Create
2. Add scopes: **CRM → contacts read** + **contacts write**
   (`crm.objects.contacts.read`, `crm.objects.contacts.write`)
3. Copy into `.env`:

```
HUBSPOT_SERVICE_KEY=pat-...
```

4. Restart API → My Tasks → grant HubSpot access → **Sync now**

## Option B — Projects OAuth (per-admin Connect)

This project (`optimum-my-tasks`) declares contacts scopes. After upload:

```bash
cd hubspot/optimum-my-tasks
hs project upload -f
```

Ensure `.env` has `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET`, then each
permitted admin clicks **Connect HubSpot** on My Tasks (re-connect if they
connected earlier with old scopes).

## API paths used by Optimum

- List: `GET /crm/objects/2026-03/tasks`
- Update: `PATCH /crm/objects/2026-03/tasks/{id}`
