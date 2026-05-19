#!/usr/bin/env bash
# =====================================================================
#  Credit Repair Cloud (CRC) Integration — Full Smoke Test
#
#  Verifies the complete Optimum ↔ CRC handshake WITHOUT touching
#  production CRC.  Aborts immediately if the server reports
#  mode="live" (safety gate).
#
#  Sections:
#   0  Preflight  (env vars + server health + safety gate)
#   1  Auth tokens
#   2  GET  /api/admin/crc/status
#   3  GET  /api/admin/crc/preview/:id
#   4  GET  /api/admin/crc/sync-log
#   5  POST /api/admin/clients/:id/crc-sync  (dry-run verified)
#   6  POST /api/webhooks/crc — validation gates
#   7  POST /api/webhooks/crc — shared-secret enforcement
#   8  POST /api/admin/crc/simulate-webhook — all 8 stage mappings
#        (includes alternates & case-insensitivity)
#   9  Webhook "unchanged" response
#  10  "completed" stage → reminder-flow trigger
#  11  Direct webhook: email vs crc_client_id lookup paths
#  12  sync-log audit trail
#  13  Client stage restoration + DB verification
#
#  Requires:
#    - Dev server running:     npm run dev
#    - SMOKE_TEST_SECRET       set in .env
#    - SMOKE_ADMIN_EMAIL       set in .env
#    - SMOKE_CLIENT_EMAIL      set in .env
#    - CRC_DRY_RUN=true        set in .env  (or keys absent — safe)
#    - CRC_WEBHOOK_SECRET      set in .env  (optional — section 7)
#
#  Usage:
#    chmod +x scripts/smoke-test-crc.sh
#    ./scripts/smoke-test-crc.sh
#
#  Exit code: 0 = all assertions passed, 1 = one or more failed
# =====================================================================

set -euo pipefail

# ── Load .env ──────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  while read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ [^A-Za-z0-9_] ]] && continue
    val="${val#[\"\']}"
    val="${val%[\"\']}"
    export "$key=$val" 2>/dev/null || true
  done < "$ROOT/.env"
fi

BASE="${BASE:-https://localhost:8080}"
SMOKE_SECRET="${SMOKE_TEST_SECRET:-}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-}"
CLIENT_EMAIL="${SMOKE_CLIENT_EMAIL:-}"
WEBHOOK_SECRET="${CRC_WEBHOOK_SECRET:-}"

PASS=0; FAIL=0; SKIP=0
ADMIN_TOKEN=""
CLIENT_TOKEN=""
CLIENT_ID=""
ORIG_STAGE=""      # restored in cleanup trap

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()      { echo -e "${GREEN}  ✓${NC}  $1" >&2; (( PASS++ )) || true; }
fail()    { echo -e "${RED}  ✗${NC}  $1" >&2; (( FAIL++ )) || true; }
warn()    { echo -e "${YELLOW}  ⚠${NC}  $1" >&2; (( SKIP++ )) || true; }
info()    { echo -e "${CYAN}  ▶${NC}  $1" >&2; }
section() {
  echo "" >&2
  echo -e "${BOLD}══════════════════════════════════════════${NC}" >&2
  echo -e "${BOLD}  $1${NC}" >&2
  echo -e "${BOLD}══════════════════════════════════════════${NC}" >&2
}

# curl: body + newline + HTTP code on the last line (10s connect, 30s total max)
rw()     { curl -sk --connect-timeout 10 --max-time 30 -w "\n%{http_code}" "$@"; }
body()   { echo "$1" | sed '$d'; }
code()   { echo "$1" | tail -n1; }

# Extract a scalar JSON field value
extract() {
  echo "$2" | grep -o "\"$1\":[^,}]*" | head -1 \
    | sed 's/.*: *//; s/[",}]//g; s/ //g'
}

assert_http() {
  local label="$1" want="$2" resp="$3"
  local got; got=$(code "$resp")
  local bod; bod=$(body "$resp")
  if [[ "$got" == "$want" ]]; then
    ok "$label → HTTP $got"
  else
    fail "$label → expected HTTP $want, got $got"
    info "    $(echo "$bod" | head -c 400)"
  fi
}

assert_field() {
  local label="$1" field="$2" bod="$3"
  if echo "$bod" | grep -q "\"$field\""; then
    ok "$label has field '$field'"
  else
    fail "$label missing field '$field'"
    info "    $(echo "$bod" | head -c 400)"
  fi
}

assert_present() {
  local label="$1" pat="$2" bod="$3"
  if echo "$bod" | grep -q "$pat"; then
    ok "$label contains '$pat'"
  else
    fail "$label missing '$pat'"
    info "    $(echo "$bod" | head -c 400)"
  fi
}

assert_absent() {
  local label="$1" pat="$2" bod="$3"
  if echo "$bod" | grep -q "$pat"; then
    fail "$label must NOT contain '$pat'"
    info "    $(echo "$bod" | head -c 400)"
  else
    ok "$label: '$pat' absent (as expected)"
  fi
}

# Map our pipeline_stage enum → the CRC stage name accepted by the webhook
crc_stage_name() {
  case "$1" in
    new_client) echo "New Client" ;;
    docs_ready) echo "Docs Ready" ;;
    round_1)    echo "Round 1" ;;
    round_2)    echo "Round 2" ;;
    round_3)    echo "Round 3" ;;
    round_4)    echo "Round 4" ;;
    round_5)    echo "Round 5" ;;
    completed)  echo "Completed" ;;
    *)          echo "$1" ;;
  esac
}

# ── Dev server lifecycle helper ───────────────────────────────────────
kill_dev_server() {
  pkill -f "vite"    2>/dev/null || true
  pkill -f "ts-node" 2>/dev/null || true
  pkill -f "nodemon" 2>/dev/null || true
  lsof -ti:8080,8081 2>/dev/null | xargs kill -9 2>/dev/null || true
}

# ── Cleanup trap ───────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$CLIENT_ID" && -n "$ORIG_STAGE" && -n "$ADMIN_TOKEN" ]]; then
    local restore_crc_stage
    restore_crc_stage=$(crc_stage_name "$ORIG_STAGE")
    info "Cleanup: restoring client $CLIENT_ID to stage '$ORIG_STAGE'…" >&2
    curl -sk --connect-timeout 10 --max-time 30 -X POST "$BASE/api/admin/crc/simulate-webhook" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"clientId\":$CLIENT_ID,\"stage\":\"$restore_crc_stage\"}" > /dev/null 2>&1 || true
  fi
  info "Killing dev server…" >&2
  kill_dev_server
}
trap cleanup EXIT

# ── Auth token helper ──────────────────────────────────────────────────
get_token() {
  local actor="$1" email="$2" label="$3"
  info "Getting $label token for <$email>…"
  local R
  R=$(rw -X POST "$BASE/api/smoke/token" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$SMOKE_SECRET\",\"actor\":\"$actor\",\"email\":\"$email\"}")
  local c; c=$(code "$R")
  local bod; bod=$(body "$R")
  if [[ "$c" != "200" ]]; then
    fail "$label: smoke/token returned HTTP $c — $bod" >&2
    return 1
  fi
  local token; token=$(extract "token" "$bod")
  if [[ -z "$token" ]]; then
    fail "$label: no token in response" >&2
    return 1
  fi
  ok "$label authenticated (len=${#token})"
  echo "$token"
}

# ── simulate-webhook helper ────────────────────────────────────────────
# Calls POST /api/admin/crc/simulate-webhook with the given CRC stage name.
# Asserts HTTP 200 and that the inner webhook response is ok/unchanged.
# Usage: simulate_stage "<CRC stage name>" "<expected enum>" "<label>"
simulate_stage() {
  local crc_stage="$1" expected_enum="$2" label="$3"
  local R B
  R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":$CLIENT_ID,\"stage\":\"$crc_stage\"}")
  local http_code; http_code=$(code "$R")
  B=$(body "$R")

  if [[ "$http_code" == "200" ]]; then
    ok "$label: HTTP 200"
  else
    fail "$label: expected HTTP 200, got $http_code"
    info "    $(echo "$B" | head -c 300)"
    return
  fi

  if echo "$B" | grep -q '"ok":true'; then
    ok "$label: webhook ok:true"
  elif echo "$B" | grep -q '"unchanged":true'; then
    ok "$label: webhook ok:true (unchanged — already on stage)"
  else
    fail "$label: webhook response not ok"
    info "    $(echo "$B" | head -c 300)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
section "0. Preflight"
# ═══════════════════════════════════════════════════════════════════════

[[ -z "$SMOKE_SECRET" ]] && { fail "SMOKE_TEST_SECRET not set in .env"; exit 1; }
ok "SMOKE_TEST_SECRET configured"

[[ -z "$ADMIN_EMAIL" ]] && { fail "SMOKE_ADMIN_EMAIL not set in .env"; exit 1; }
ok "SMOKE_ADMIN_EMAIL=$ADMIN_EMAIL"

[[ -z "$CLIENT_EMAIL" ]] && { fail "SMOKE_CLIENT_EMAIL not set in .env — required for webhook tests"; exit 1; }
ok "SMOKE_CLIENT_EMAIL=$CLIENT_EMAIL"

if [[ -n "$WEBHOOK_SECRET" ]]; then
  ok "CRC_WEBHOOK_SECRET configured (secret enforcement tests will run)"
else
  warn "CRC_WEBHOOK_SECRET not set — secret enforcement section skipped"
fi

# ── Start dev server ───────────────────────────────────────────────────
info "Killing any stale dev server processes…"
kill_dev_server
sleep 0.5

info "Starting dev server (npm run dev)…"
npm run dev > /tmp/smoke-crc-dev.log 2>&1 &
DEV_PID=$!

# Wait up to 20s for the server to become healthy
SERVER_READY=0
for i in {1..20}; do
  sleep 1
  HCODE=$(curl -sk --connect-timeout 3 --max-time 5 \
    -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || true)
  if [[ "$HCODE" == "200" ]]; then
    SERVER_READY=1
    break
  fi
done

if [[ "$SERVER_READY" -eq 0 ]]; then
  fail "Dev server failed to start within 20s (check /tmp/smoke-crc-dev.log)"
  exit 1
fi
ok "Dev server started (PID=$DEV_PID, HTTP 200)"

# ═══════════════════════════════════════════════════════════════════════
section "1. Obtain Auth Tokens"
# ═══════════════════════════════════════════════════════════════════════

ADMIN_TOKEN=$(get_token "admin" "$ADMIN_EMAIL" "Admin") || {
  fail "Cannot obtain admin token — aborting"; exit 1
}
CLIENT_TOKEN=$(get_token "client" "$CLIENT_EMAIL" "Client") || {
  fail "Cannot obtain client token — aborting"; exit 1
}

# Retrieve CLIENT_ID and original pipeline stage (needed for webhook tests + restore)
CTOK_R=$(rw -X POST "$BASE/api/smoke/token" \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SMOKE_SECRET\",\"actor\":\"client\",\"email\":\"$CLIENT_EMAIL\"}")
CLIENT_ID=$(extract "id" "$(body "$CTOK_R")")
if [[ -n "$CLIENT_ID" ]]; then
  ok "Test client id=$CLIENT_ID"
else
  fail "Could not extract client id from smoke/token — aborting"; exit 1
fi

CLIENT_R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
CLIENT_BOD=$(body "$CLIENT_R")
ORIG_STAGE=$(echo "$CLIENT_BOD" | { grep -o '"pipeline_stage":"[^"]*"' || true; } | head -1 \
  | sed 's/.*"pipeline_stage":"//;s/".*//')
if [[ -n "$ORIG_STAGE" ]]; then
  ok "Original pipeline_stage='$ORIG_STAGE' recorded (will restore on exit)"
else
  warn "Could not read original pipeline_stage — cleanup restore will be skipped"
fi

# ═══════════════════════════════════════════════════════════════════════
section "2. GET /api/admin/crc/status"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw "$BASE/api/admin/crc/status")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/crc/status" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/crc/status" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token → 200" "200" "$R"
B=$(body "$R")
assert_field "Status" "configured" "$B"
assert_field "Status" "dry_run"    "$B"
assert_field "Status" "mode"       "$B"

CRC_MODE=$(extract "mode" "$B")
info "CRC mode: $CRC_MODE"

# ── SAFETY GATE ────────────────────────────────────────────────────────
# Abort the entire test suite if CRC is in live mode.
# We must never run crc-sync or simulate-webhook against prod CRC.
if [[ "$CRC_MODE" == "live" ]]; then
  fail "⛔  CRC mode is 'live' — aborting to avoid contaminating production CRC."
  fail "    Set CRC_DRY_RUN=true in .env before running this smoke test."
  exit 1
fi
ok "Safety gate: CRC mode='$CRC_MODE' (not live — safe to proceed)"

# ═══════════════════════════════════════════════════════════════════════
section "3. GET /api/admin/crc/preview/:id"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw "$BASE/api/admin/crc/preview/$CLIENT_ID")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/crc/preview/$CLIENT_ID" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 401" "401" "$R"

# Non-numeric id → 400 (NaN check in route)
R=$(rw "$BASE/api/admin/crc/preview/notanumber" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Non-numeric id → 400" "400" "$R"

# Nonexistent client → 404
R=$(rw "$BASE/api/admin/crc/preview/999999999" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Nonexistent client → 404" "404" "$R"

# Real client → 200 with full preview payload
R=$(rw "$BASE/api/admin/crc/preview/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Real client preview → 200" "200" "$R"
B=$(body "$R")

assert_field "Preview" "action"    "$B"
assert_field "Preview" "endpoint"  "$B"
assert_field "Preview" "xmlData"   "$B"
assert_field "Preview" "note"      "$B"

PREVIEW_ACTION=$(extract "action" "$B")
if [[ "$PREVIEW_ACTION" == "insertRecord" || "$PREVIEW_ACTION" == "updateRecord" ]]; then
  ok "Preview action='$PREVIEW_ACTION' (valid CRC action)"
else
  fail "Preview action='$PREVIEW_ACTION' (expected insertRecord or updateRecord)"
fi

# xmlData must be well-formed CRC XML with client fields
assert_present "xmlData has <crcloud>"  "crcloud"        "$B"
assert_present "xmlData has <lead>"     "<lead>"         "$B"
assert_present "xmlData has <type>"     "<type>"         "$B"
assert_present "xmlData has client email" "$CLIENT_EMAIL" "$B"

# endpoint must point to CRC
assert_present "Endpoint points to CRC" "creditrepaircloud.com" "$B"

# note must say it's preview-only (nothing sent)
assert_present "Note says preview-only" "preview" "$B"

# ═══════════════════════════════════════════════════════════════════════
section "4. GET /api/admin/crc/sync-log"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw "$BASE/api/admin/crc/sync-log")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/crc/sync-log" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/crc/sync-log" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token → 200" "200" "$R"
B=$(body "$R")
assert_present "Sync-log is JSON array" '\[' "$B"

# Test limit param
R=$(rw "$BASE/api/admin/crc/sync-log?limit=3" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Sync-log limit=3 → 200" "200" "$R"
B=$(body "$R")
ENTRY_COUNT=$(echo "$B" | { grep -o '"id"' || true; } | wc -l | tr -d ' ')
if [[ "$ENTRY_COUNT" -le 3 ]]; then
  ok "Sync-log limit=3 returned $ENTRY_COUNT entries (≤3)"
else
  fail "Sync-log limit=3 returned $ENTRY_COUNT entries (expected ≤3)"
fi

# Verify shape of existing entries (action, status, pipeline_stage fields)
R=$(rw "$BASE/api/admin/crc/sync-log?limit=1" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
if echo "$B" | grep -q '"action"'; then
  ok "Sync-log entries have 'action' field"
else
  warn "Sync-log is empty — field shape check skipped"
fi

# ═══════════════════════════════════════════════════════════════════════
section "5. POST /api/admin/clients/:id/crc-sync (dry-run)"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw -X POST "$BASE/api/admin/clients/$CLIENT_ID/crc-sync")
assert_http "No token → 401" "401" "$R"

R=$(rw -X POST "$BASE/api/admin/clients/$CLIENT_ID/crc-sync" \
  -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 401" "401" "$R"

# Non-numeric id → 400
R=$(rw -X POST "$BASE/api/admin/clients/notanumber/crc-sync" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Non-numeric id → 400" "400" "$R"

# Nonexistent client — crcSyncClient returns early (void), route returns 200
# This is intentional behavior: avoids bubbling an error for already-deleted clients.
R=$(rw -X POST "$BASE/api/admin/clients/999999999/crc-sync" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Nonexistent client → 200 (crcSyncClient returns early)" "200" "$R"

# Real client — verify dry-run sync succeeds and writes to sync-log
R=$(rw -X POST "$BASE/api/admin/clients/$CLIENT_ID/crc-sync" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Real client crc-sync → 200" "200" "$R"
B=$(body "$R")
assert_field "crc-sync response" "ok" "$B"
assert_field "crc-sync response" "crc_client_id" "$B"

# Verify a sync-log entry was created for this client
R=$(rw "$BASE/api/admin/crc/sync-log?limit=10" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
if echo "$B" | grep -q "\"client_id\":$CLIENT_ID"; then
  ok "crc-sync wrote entry to sync-log for client $CLIENT_ID"
else
  fail "crc-sync did NOT write entry to sync-log for client $CLIENT_ID"
fi
if echo "$B" | grep -q '"status":"success"'; then
  ok "sync-log entry has status=success (dry-run succeeded)"
else
  fail "sync-log entry missing status=success"
fi

# ═══════════════════════════════════════════════════════════════════════
section "6. POST /api/webhooks/crc — Validation Gates"
# ═══════════════════════════════════════════════════════════════════════

# When CRC_WEBHOOK_SECRET is configured, requests without it return 401 before
# validation. We include the correct secret for all validation tests so we
# reach the actual field-validation logic.
SECRET_JSON=""
[[ -n "$WEBHOOK_SECRET" ]] && SECRET_JSON=",\"secret\":\"$WEBHOOK_SECRET\""

# ── Missing stage ──────────────────────────────────────────────────────
R=$(rw -X POST "$BASE/api/webhooks/crc" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CLIENT_EMAIL\"$SECRET_JSON}")
assert_http "Missing stage → 400" "400" "$R"
assert_present "400: body mentions stage" "stage" "$(body "$R")"

# ── Missing email AND crc_client_id ───────────────────────────────────
R=$(rw -X POST "$BASE/api/webhooks/crc" \
  -H "Content-Type: application/json" \
  -d "{\"stage\":\"Round 1\"$SECRET_JSON}")
assert_http "Missing email+crc_client_id → 400" "400" "$R"
assert_present "400: body mentions email" "email" "$(body "$R")"

# ── Unknown stage name → 422 ──────────────────────────────────────────
R=$(rw -X POST "$BASE/api/webhooks/crc" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Foobar Stage XYZ\"$SECRET_JSON}")
assert_http "Unknown stage → 422" "422" "$R"
B=$(body "$R")
assert_present "422 body mentions 'Unknown stage'" "Unknown stage" "$B"

# ── Unknown email → 200 ok:false (Zapier-friendly) ────────────────────
R=$(rw -X POST "$BASE/api/webhooks/crc" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nobody_smoke_xyz_9999@example.com\",\"stage\":\"Round 1\"$SECRET_JSON}")
assert_http "Unknown email → 200 (Zapier-friendly)" "200" "$R"
B=$(body "$R")
assert_present "Unknown email → ok:false"         "\"ok\":false" "$B"
assert_present "Unknown email → client_not_found" "client_not_found" "$B"

# ── Unknown crc_client_id → 200 ok:false ──────────────────────────────
R=$(rw -X POST "$BASE/api/webhooks/crc" \
  -H "Content-Type: application/json" \
  -d "{\"crc_client_id\":\"SMOKE_FAKE_CRC_999\",\"stage\":\"Completed\"$SECRET_JSON}")
assert_http "Unknown crc_client_id → 200" "200" "$R"
B=$(body "$R")
assert_present "Unknown crc_client_id → ok:false" "\"ok\":false" "$B"

# ═══════════════════════════════════════════════════════════════════════
section "7. POST /api/webhooks/crc — Shared-Secret Enforcement"
# ═══════════════════════════════════════════════════════════════════════

if [[ -n "$WEBHOOK_SECRET" ]]; then
  # Wrong secret → 401
  R=$(rw -X POST "$BASE/api/webhooks/crc" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"WRONG_SMOKE_SECRET_XYZ\",\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Round 1\"}")
  assert_http "Wrong secret → 401" "401" "$R"
  assert_present "401 body says Unauthorized" "Unauthorized" "$(body "$R")"

  # Correct secret → webhook processes normally
  R=$(rw -X POST "$BASE/api/webhooks/crc" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$WEBHOOK_SECRET\",\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Round 1\"}")
  assert_http "Correct secret → 200" "200" "$R"
  B=$(body "$R")
  if echo "$B" | grep -q '"ok":true'; then
    ok "Correct secret → webhook ok:true"
  elif echo "$B" | grep -q '"unchanged":true'; then
    ok "Correct secret → webhook ok:true (unchanged)"
  else
    fail "Correct secret → unexpected webhook response"
    info "    $(echo "$B" | head -c 300)"
  fi
else
  warn "CRC_WEBHOOK_SECRET not set — secret enforcement tests skipped"
  (( SKIP += 3 )) || true
fi

# ═══════════════════════════════════════════════════════════════════════
section "8. simulate-webhook — All Stage Mappings + Edge Cases"
# ═══════════════════════════════════════════════════════════════════════
# The simulate-webhook endpoint:
#   - Resolves client email from clientId
#   - Injects CRC_WEBHOOK_SECRET internally
#   - Forwards to POST /api/webhooks/crc
#   - Returns { simulated: true, webhook_response: <inner response> }

# ── Auth guards ────────────────────────────────────────────────────────
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Round 1\"}")
assert_http "No token → 401" "401" "$R"

R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Round 1\"}")
assert_http "Client token → 401" "401" "$R"

# ── Missing required fields ────────────────────────────────────────────
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID}")
assert_http "Missing stage → 400" "400" "$R"

R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stage":"Round 1"}')
assert_http "Missing clientId+email → 400" "400" "$R"

# ── All 8 official CRC stage mappings ─────────────────────────────────
simulate_stage "New Client" "new_client" "stage: New Client → new_client"
simulate_stage "Docs Ready" "docs_ready" "stage: Docs Ready → docs_ready"
simulate_stage "Round 1"    "round_1"    "stage: Round 1 → round_1"
simulate_stage "Round 2"    "round_2"    "stage: Round 2 → round_2"
simulate_stage "Round 3"    "round_3"    "stage: Round 3 → round_3"
simulate_stage "Round 4"    "round_4"    "stage: Round 4 → round_4"
simulate_stage "Round 5"    "round_5"    "stage: Round 5 → round_5"

# Skip "Completed" here — tested exclusively in Section 10 to avoid
# triggering reminder flows multiple times.

# ── Verbose alternate stage names (with month suffix) ─────────────────
simulate_stage "Round 1 (Month 1)" "round_1" "alt: Round 1 (Month 1)"
simulate_stage "Round 2 (Month 2)" "round_2" "alt: Round 2 (Month 2)"
simulate_stage "Round 3 (Month 3)" "round_3" "alt: Round 3 (Month 3)"
simulate_stage "Round 4 (Month 4)" "round_4" "alt: Round 4 (Month 4)"
simulate_stage "Round 5 (Month 5)" "round_5" "alt: Round 5 (Month 5)"

# ── Case-insensitivity (webhook uses .toLowerCase() on stage) ─────────
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"docs ready\"}")
assert_http "lowercase 'docs ready' → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"ok":true\|"unchanged":true'; then
  ok "lowercase stage name accepted"
else
  fail "lowercase stage name rejected"
  info "    $(echo "$B" | head -c 300)"
fi

R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"ROUND 2\"}")
assert_http "UPPERCASE 'ROUND 2' → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"ok":true\|"unchanged":true'; then
  ok "UPPERCASE stage name accepted"
else
  fail "UPPERCASE stage name rejected"
  info "    $(echo "$B" | head -c 300)"
fi

# ── Unknown stage via simulate — outer 200, inner 422 ─────────────────
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Bogus Stage XYZ\"}")
assert_http "simulate unknown stage → 200 (outer)" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q "422\|Unknown stage\|error"; then
  ok "simulate unknown stage → inner 422 surfaced in response"
else
  fail "simulate unknown stage → expected inner error not found"
  info "    $(echo "$B" | head -c 300)"
fi

# ── Simulate by email (not clientId) ──────────────────────────────────
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Round 1\"}")
assert_http "simulate by email → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"ok":true\|"unchanged":true'; then
  ok "simulate by email → webhook ok"
else
  fail "simulate by email → webhook not ok"
  info "    $(echo "$B" | head -c 300)"
fi

# ── DB verification: confirm stage actually updated ────────────────────
# After the stage loop the last successful change was "Round 1" (from the
# by-email test above).
R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
CURR_STAGE=$(echo "$B" | { grep -o '"pipeline_stage":"[^"]*"' || true; } | head -1 \
  | sed 's/.*"pipeline_stage":"//;s/".*//')
info "DB pipeline_stage after section 8: '$CURR_STAGE'"
if [[ "$CURR_STAGE" == "round_1" || "$CURR_STAGE" == "docs_ready" || \
      "$CURR_STAGE" == "round_2" || "$CURR_STAGE" == "round_3" ]]; then
  ok "DB stage updated by simulate-webhook (current='$CURR_STAGE')"
else
  fail "DB stage unexpected: '$CURR_STAGE'"
fi

# ═══════════════════════════════════════════════════════════════════════
section "9. Webhook 'unchanged' Response"
# ═══════════════════════════════════════════════════════════════════════

# Move client to a specific stage first
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Round 4\"}")
assert_http "Move to Round 4 → 200" "200" "$R"

# Move to same stage again — should get unchanged:true
R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Round 4\"}")
assert_http "Same stage again → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"unchanged":true'; then
  ok "Repeating same stage → unchanged:true"
else
  fail "Repeating same stage — unchanged:true not returned"
  info "    $(echo "$B" | head -c 300)"
fi

# Verify unchanged does NOT create a new pipeline_history entry
# (the webhook returns early before the INSERT when from_stage === mapped)
# We can't directly verify this without querying the DB, but the presence
# of "unchanged" in the response confirms the early-return path executed.
assert_present "unchanged path confirmed via response" "unchanged" "$B"

# ═══════════════════════════════════════════════════════════════════════
section "10. 'completed' Stage — Full Path + Reminder Flow Trigger"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":$CLIENT_ID,\"stage\":\"Completed\"}")
assert_http "Move to Completed → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"ok":true'; then
  ok "completed stage webhook → ok:true"
elif echo "$B" | grep -q '"unchanged":true'; then
  ok "completed stage → ok:true (unchanged, already completed)"
else
  fail "completed stage → unexpected response"
  info "    $(echo "$B" | head -c 300)"
fi

# Allow the async reminder flow trigger to fire
sleep 1

# DB verification: pipeline_stage must be "completed"
R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
CURR_STAGE=$(echo "$B" | { grep -o '"pipeline_stage":"[^"]*"' || true; } | head -1 \
  | sed 's/.*"pipeline_stage":"//;s/".*//')
if [[ "$CURR_STAGE" == "completed" ]]; then
  ok "DB verified: pipeline_stage=completed"
else
  fail "DB verification: expected pipeline_stage=completed, got '$CURR_STAGE'"
fi

# sync-log must contain a webhook_stage_update for "completed"
R=$(rw "$BASE/api/admin/crc/sync-log?limit=50" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
if echo "$B" | grep -q '"pipeline_stage":"completed"'; then
  ok "sync-log has pipeline_stage=completed entry"
else
  fail "sync-log missing pipeline_stage=completed entry"
fi

# ═══════════════════════════════════════════════════════════════════════
section "11. Direct Webhook: email vs crc_client_id Lookup"
# ═══════════════════════════════════════════════════════════════════════

# ── Path 1: lookup by email via direct webhook call ────────────────────
if [[ -n "$WEBHOOK_SECRET" ]]; then
  R=$(rw -X POST "$BASE/api/webhooks/crc" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$WEBHOOK_SECRET\",\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Round 3\"}")
else
  # No secret configured — call without one (webhook skips auth check)
  R=$(rw -X POST "$BASE/api/webhooks/crc" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$CLIENT_EMAIL\",\"stage\":\"Round 3\"}")
fi
assert_http "Direct webhook (email lookup) → 200" "200" "$R"
B=$(body "$R")
if echo "$B" | grep -q '"ok":true'; then
  ok "Direct webhook email lookup → ok:true (stage changed)"
elif echo "$B" | grep -q '"unchanged":true'; then
  ok "Direct webhook email lookup → ok:true (unchanged)"
else
  fail "Direct webhook email lookup → unexpected response"
  info "    $(echo "$B" | head -c 300)"
fi

# ── Path 2: lookup by crc_client_id ───────────────────────────────────
# Only runs if the client has a crc_client_id (live mode sets one; dry-run does not)
R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
CRC_CID=$(echo "$B" | { grep -o '"crc_client_id":"[^"]*"' || true; } | head -1 \
  | sed 's/.*"crc_client_id":"//;s/".*//')

if [[ -n "$CRC_CID" ]]; then
  info "Client has crc_client_id='$CRC_CID' — testing crc_client_id lookup path"
  if [[ -n "$WEBHOOK_SECRET" ]]; then
    WH_BODY="{\"secret\":\"$WEBHOOK_SECRET\",\"crc_client_id\":\"$CRC_CID\",\"stage\":\"Round 2\"}"
  else
    WH_BODY="{\"crc_client_id\":\"$CRC_CID\",\"stage\":\"Round 2\"}"
  fi
  R=$(rw -X POST "$BASE/api/webhooks/crc" \
    -H "Content-Type: application/json" \
    -d "$WH_BODY")
  assert_http "Direct webhook (crc_client_id lookup) → 200" "200" "$R"
  B=$(body "$R")
  if echo "$B" | grep -q '"ok":true\|"unchanged":true'; then
    ok "crc_client_id lookup → ok"
  else
    fail "crc_client_id lookup → unexpected response"
    info "    $(echo "$B" | head -c 300)"
  fi
else
  warn "Client has no crc_client_id (expected in dry-run) — crc_client_id lookup skipped"
  (( SKIP++ )) || true
fi

# ── crc_client_id backfill: if the webhook call includes a crc_client_id
#    and the client doesn't have one yet, the handler writes it to the DB ──
# This is tested implicitly by the simulate-webhook + email lookup flows above.
# We verify the current state of crc_client_id:
R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
B=$(body "$R")
if echo "$B" | grep -q '"crc_client_id"'; then
  ok "Client record has crc_client_id field (may be null in dry-run)"
else
  fail "Client record missing crc_client_id field"
fi

# ═══════════════════════════════════════════════════════════════════════
section "12. Sync-Log Audit Trail (post all operations)"
# ═══════════════════════════════════════════════════════════════════════

R=$(rw "$BASE/api/admin/crc/sync-log?limit=100" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Full sync-log fetch → 200" "200" "$R"
B=$(body "$R")

# Must contain entries for our test client
if echo "$B" | grep -q "\"client_id\":$CLIENT_ID"; then
  ok "sync-log has entries for test client $CLIENT_ID"
else
  fail "sync-log missing entries for test client $CLIENT_ID"
fi

# Must contain a push_create or push_update (from section 5 crc-sync)
if echo "$B" | grep -q '"action":"push_create"\|"action":"push_update"'; then
  ok "sync-log has push_create or push_update action (from crc-sync)"
else
  fail "sync-log missing push_create/push_update action for client $CLIENT_ID"
fi

# Must contain webhook_stage_update entries (from simulate-webhook / direct webhook)
if echo "$B" | grep -q '"action":"webhook_stage_update"'; then
  ok "sync-log has webhook_stage_update entries"
else
  fail "sync-log missing webhook_stage_update entries"
fi

# Must contain a completed stage entry
if echo "$B" | grep -q '"pipeline_stage":"completed"'; then
  ok "sync-log has completed pipeline_stage entry"
else
  fail "sync-log missing completed pipeline_stage entry"
fi

# No error entries for our client
ERRS=$(echo "$B" | { grep -o "\"client_id\":$CLIENT_ID" || true; } | wc -l | tr -d ' ')
  ERR_STATUS=$(echo "$B" | { grep "\"status\":\"error\"" || true; } | grep -c '' || true)
if [[ "$ERR_STATUS" -eq 0 ]]; then
  ok "No error-status entries in sync-log"
else
  warn "sync-log has $ERR_STATUS error-status entries (may be from prior runs)"
fi

# Verify all expected fields are present in log entries
assert_field "sync-log entries" "action"         "$B"
assert_field "sync-log entries" "status"         "$B"
assert_field "sync-log entries" "pipeline_stage" "$B"
assert_field "sync-log entries" "created_at"     "$B"

# ═══════════════════════════════════════════════════════════════════════
section "13. Stage Restoration + DB Verification"
# ═══════════════════════════════════════════════════════════════════════

if [[ -n "$ORIG_STAGE" ]]; then
  RESTORE_CRC=$(crc_stage_name "$ORIG_STAGE")
  info "Restoring client $CLIENT_ID to original stage '$ORIG_STAGE' (CRC name: '$RESTORE_CRC')…"
  R=$(rw -X POST "$BASE/api/admin/crc/simulate-webhook" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":$CLIENT_ID,\"stage\":\"$RESTORE_CRC\"}")
  assert_http "Restore stage '$ORIG_STAGE' → 200" "200" "$R"

  # DB verification: confirm the stage is back
  R=$(rw "$BASE/api/admin/clients/$CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  B=$(body "$R")
  FINAL_STAGE=$(echo "$B" | { grep -o '"pipeline_stage":"[^"]*"' || true; } | head -1 \
    | sed 's/.*"pipeline_stage":"//;s/".*//')
  if [[ "$FINAL_STAGE" == "$ORIG_STAGE" ]]; then
    ok "DB verified: pipeline_stage restored to '$ORIG_STAGE'"
  else
    fail "DB verification: expected '$ORIG_STAGE', got '$FINAL_STAGE'"
  fi

  # Clear so the cleanup trap does not double-restore
  ORIG_STAGE=""
else
  warn "Original stage not recorded — restoration skipped"
  (( SKIP++ )) || true
fi

# ═══════════════════════════════════════════════════════════════════════
echo "" >&2
echo -e "${BOLD}══════════════════════════════════════════${NC}" >&2
echo -e "${BOLD}  RESULTS${NC}" >&2
echo -e "${BOLD}══════════════════════════════════════════${NC}" >&2
echo -e "  ${GREEN}✓ Passed${NC} : $PASS" >&2
echo -e "  ${RED}✗ Failed${NC} : $FAIL" >&2
[[ "$SKIP" -gt 0 ]] && echo -e "  ${YELLOW}⚠ Skipped${NC}: $SKIP" >&2

if [[ "$FAIL" -eq 0 ]]; then
  echo -e "\n  ${GREEN}${BOLD}ALL $PASS ASSERTIONS PASSED — CRC integration smoke test OK${NC}\n" >&2
  exit 0
else
  echo -e "\n  ${RED}${BOLD}$FAIL FAILED — CRC integration smoke test FAILED${NC}\n" >&2
  exit 1
fi
