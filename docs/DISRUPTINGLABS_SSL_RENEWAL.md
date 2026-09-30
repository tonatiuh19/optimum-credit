# DisruptingLabs SSL certificate renewal (HostGator)

How to renew HTTPS for **`disruptinglabs.com`** when HostGator AutoSSL fails or the cert expires.

**Why this matters:** Optimum Credit CDN uploads, logos, and MMS assets use `https://disruptinglabs.com/...`. An expired or mismatched cert breaks Node `fetch` (e.g. `fetch failed` / hostname mismatch).

**Last known-good approach (Sep 2026):** Issue an **RSA SAN** cert on a Mac with Certbot (DNS-01), then paste into cPanel. Do **not** rely on AutoSSL for wildcards.

---

## Recommended certificate (Option 1 — SAN)

One Let’s Encrypt cert covering only what you use:

| Name | Purpose |
|------|---------|
| `disruptinglabs.com` | **Required** — CDN / uploads / assets |
| `www.disruptinglabs.com` | Optional public www |
| `mail.disruptinglabs.com` | HostGator mail hostname |
| `webmail.disruptinglabs.com` | Webmail UI |

Skip unused names (`autoconfig`, `cpanel`, `*.alan.chat`, etc.).

**Prefer RSA 2048**, not ECDSA. HostGator’s “Install an SSL Website” often shows **“The certificate is not valid”** for ECDSA keys.

**Wildcard (`*.disruptinglabs.com`)** works technically but AutoSSL on this host has been unreliable; use SAN unless you truly need every subdomain.

---

## Safety rules (do not break prod)

1. **Generate the new cert first** (Mac). Do **not** uninstall the live apex cert until the new files are ready.
2. The new cert **must include `disruptinglabs.com`** so one Install keeps CDN working.
3. Keep the previous working cert in cPanel **Certificates** list until live HTTPS is verified.
4. After Install, immediately verify:

```bash
echo | openssl s_client -servername disruptinglabs.com -connect disruptinglabs.com:443 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
```

You want `CN`/`SAN` to include `disruptinglabs.com` and a future `notAfter` date.

5. **Rollback:** cPanel → SSL/TLS → Certificates → find the previous good apex (or SAN) cert → **Install** on `disruptinglabs.com` again.

---

## One-time Mac setup

```bash
brew install certbot
mkdir -p ~/letsencrypt/{work,logs,hooks}
```

Optional auth/cleanup hooks (pause for each DNS TXT):

```bash
cat > ~/letsencrypt/hooks/auth.sh <<'EOF'
#!/bin/bash
set -euo pipefail
OUT="$HOME/letsencrypt/challenge.txt"
GO="$HOME/letsencrypt/go"
rm -f "$GO"
{
  echo "DOMAIN=$CERTBOT_DOMAIN"
  echo "VALIDATION=$CERTBOT_VALIDATION"
  echo "NAME=_acme-challenge.${CERTBOT_DOMAIN}"
} > "$OUT"
echo "Add TXT $NAME = $VALIDATION then: touch ~/letsencrypt/go"
for i in $(seq 1 720); do
  [ -f "$GO" ] && { rm -f "$GO"; sleep 12; exit 0; }
  sleep 5
done
exit 1
EOF
chmod +x ~/letsencrypt/hooks/auth.sh
echo '#!/bin/bash' > ~/letsencrypt/hooks/cleanup.sh
chmod +x ~/letsencrypt/hooks/cleanup.sh
```

---

## Issue a new RSA SAN cert (DNS-01)

```bash
rm -f ~/letsencrypt/go ~/letsencrypt/challenge.txt

certbot certonly --manual --preferred-challenges dns \
  -d disruptinglabs.com \
  -d www.disruptinglabs.com \
  -d mail.disruptinglabs.com \
  -d webmail.disruptinglabs.com \
  --key-type rsa --rsa-key-size 2048 \
  --cert-name disruptinglabs.com-san \
  --manual-auth-hook ~/letsencrypt/hooks/auth.sh \
  --manual-cleanup-hook ~/letsencrypt/hooks/cleanup.sh \
  --config-dir ~/letsencrypt \
  --work-dir ~/letsencrypt/work \
  --logs-dir ~/letsencrypt/logs \
  --agree-tos --no-eff-email -m admin@disruptinglabs.com
```

For **each** domain Certbot requests:

1. Read `~/letsencrypt/challenge.txt` (`NAME` + `VALIDATION`).
2. HostGator cPanel → **Zone Editor** → add **TXT**:
   - Name e.g. `_acme-challenge`, `_acme-challenge.www`, `_acme-challenge.mail`, `_acme-challenge.webmail`
   - Value = `VALIDATION` (exact)
3. Wait 1–2 minutes; confirm:

```bash
dig @8.8.8.8 +short TXT _acme-challenge.mail.disruptinglabs.com   # example
```

4. Continue Certbot:

```bash
touch ~/letsencrypt/go
```

Repeat until Certbot prints success.

**Files:**

```text
~/letsencrypt/live/disruptinglabs.com-san/cert.pem       # leaf (CRT)
~/letsencrypt/live/disruptinglabs.com-san/privkey.pem    # KEY
~/letsencrypt/live/disruptinglabs.com-san/chain.pem      # CABUNDLE
~/letsencrypt/live/disruptinglabs.com-san/fullchain.pem  # leaf + chain
```

Prepare a traditional RSA key (cPanel-friendly):

```bash
openssl rsa -in ~/letsencrypt/live/disruptinglabs.com-san/privkey.pem \
  -traditional -out ~/letsencrypt/san-cpanel-privkey.pem

open -a TextEdit \
  ~/letsencrypt/live/disruptinglabs.com-san/cert.pem \
  ~/letsencrypt/san-cpanel-privkey.pem \
  ~/letsencrypt/live/disruptinglabs.com-san/chain.pem
```

Confirm RSA (not ECDSA):

```bash
openssl x509 -in ~/letsencrypt/live/disruptinglabs.com-san/cert.pem -noout -text \
  | grep -E 'Public Key Algorithm|Public-Key:|DNS:'
```

---

## Install in HostGator cPanel

1. **SSL/TLS → Installation** (“Install an SSL Website”).
2. Domain: **`disruptinglabs.com`** (ignore the yellow SNI note).
3. Paste:
   - **Certificate (CRT)** → `cert.pem` (one `BEGIN`/`END` block)
   - **Private Key (KEY)** → `san-cpanel-privkey.pem`
   - **CABUNDLE** → `chain.pem`
4. Do **not** click **Autofill by Domain** (pulls an old/wrong cert).
5. **Install Certificate**.
6. Verify live (commands in Safety rules above).
7. Optional: delete expired/wrong certs from **Certificates** only after live check passes (old ECDSA, expired wildcards, `alan.chat`-labeled junk). **Do not** delete the cert you just installed.

### Status page expectations

- Green on: `disruptinglabs.com`, and ideally `www` / `mail` / `webmail` if included in the SAN.
- Red on unused hosts is fine.
- Exclude broken `*.alan.chat` rows from AutoSSL so they do not poison runs.

---

## What usually goes wrong

| Symptom | Cause | Fix |
|---------|--------|-----|
| AutoSSL / Wizard fails on `*.disruptinglabs.com` | Wildcard needs DNS-01; AutoSSL flaky | Use Certbot SAN + upload |
| “The certificate is not valid” in Install | ECDSA cert, or truncated paste | Re-issue with `--key-type rsa`; paste full PEM |
| Live HTTPS still shows `mail`/`cpcalendars` CN | Old cert still bound on the vhost | Install the new RSA SAN again; remove old mail-only cert from active SSL host |
| CDN `fetch failed` | Apex hostname mismatch or expired cert | Ensure live SAN includes `disruptinglabs.com` |
| `alan.chat` AutoSSL errors | DNS does not resolve | **Exclude from AutoSSL** |

---

## Apex-only (minimal / emergency)

If you only need CDN restored quickly:

```bash
certbot certonly --manual --preferred-challenges dns \
  -d disruptinglabs.com \
  --key-type rsa --rsa-key-size 2048 \
  --cert-name disruptinglabs.com-rsa \
  # ... same config-dir / hooks as above ...
```

Install that single name on `disruptinglabs.com`. Expand to SAN later when safe.

---

## Renewal cadence

Let’s Encrypt certs last **~90 days**. Set a calendar reminder ~2 weeks before expiry (`openssl` `notAfter`). Repeat this runbook; leave prod on the old cert until the new Install succeeds and live verify passes.

---

## Related

- Optimum CDN upload URL: `https://disruptinglabs.com/data/api/uploadFiles.php`
- Env: `CDN_UPLOAD_URL`, `CDN_UPLOAD_SECRET` (see `.env.example`)
- Design notes: `DESIGN_SYSTEM.md` (CDN / AutoSSL mention)
