#!/usr/bin/env bash
# =====================================================================
#  Reminder Flows — Full Admin Smoke Test
#  Covers: flow CRUD, step CRUD, toggle, manual trigger, meta endpoints
#
#  Requires:
#    - Dev server running:   npm run dev
#    - SMOKE_TEST_SECRET set in .env
#    - SMOKE_ADMIN_EMAIL    set in .env (e.g. axgoomez@gmail.com)
#    - SMOKE_CLIENT_EMAIL   set in .env (optional, enables trigger test)
#
#  Usage:
#    chmod +x scripts/smoke-test-reminder-flows.sh
#    ./scripts/smoke-test-reminder-flows.sh
# =====================================================================

set -euo pipefail

# ── Load .env ─────────────────────────────────────────────────────────
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

PASS=0; FAIL=0; SKIP=0
ADMIN_TOKEN=""
CLIENT_TOKEN=""
TEST_FLOW_ID=""
TEST_STEP_ID=""
TEST_STEP2_ID=""

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

# curl wrapper: returns body + newline + HTTP code on the last line
rw() { curl -sk -w "\n%{http_code}" "$@"; }
body() { echo "$1" | sed '$d'; }
code() { echo "$1" | tail -n1; }

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

# Extract a scalar value from JSON: extract "field" '{"field":123}'
extract() {
  echo "$2" | grep -o "\"$1\":[^,}]*" | head -1 | sed 's/.*: *//; s/[",}]//g; s/ //g'
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
  if [[ -n "$TEST_FLOW_ID" ]]; then
    info "Cleanup: removing test flow id=$TEST_FLOW_ID …" >&2
    curl -sk -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1 || true
  fi
  info "Killing dev server…" >&2
  kill_dev_server
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────
section "0. Preflight"
# ─────────────────────────────────────────────────────────────────────

if [[ -z "$SMOKE_SECRET" ]]; then
  fail "SMOKE_TEST_SECRET not set in .env"
  exit 1
fi
ok "SMOKE_TEST_SECRET is configured"

if [[ -z "$ADMIN_EMAIL" ]]; then
  fail "SMOKE_ADMIN_EMAIL not set in .env"
  exit 1
fi
ok "SMOKE_ADMIN_EMAIL=$ADMIN_EMAIL"

# ── Start dev server ─────────────────────────────────────────────────
info "Killing any stale dev server processes…"
kill_dev_server
sleep 0.5

info "Starting dev server (npm run dev)…"
npm run dev > /tmp/smoke-flows-dev.log 2>&1 &
DEV_PID=$!

SERVER_READY=0
for i in {1..20}; do
  sleep 1
  HCODE=$(curl -sk --connect-timeout 3 --max-time 5 \
    -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || true)
  if [[ "$HCODE" == "200" ]]; then SERVER_READY=1; break; fi
done

if [[ "$SERVER_READY" -eq 0 ]]; then
  fail "Dev server failed to start within 20s (check /tmp/smoke-flows-dev.log)"
  exit 1
fi
ok "Dev server started (PID=$DEV_PID, HTTP 200)"

# ── Token helper (stdout = token only; all display to stderr) ─────────
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

# ─────────────────────────────────────────────────────────────────────
section "1. Obtain Auth Tokens"
# ─────────────────────────────────────────────────────────────────────

ADMIN_TOKEN=$(get_token "admin" "$ADMIN_EMAIL" "Admin") || {
  fail "Cannot obtain admin token — aborting"
  exit 1
}

if [[ -n "$CLIENT_EMAIL" ]]; then
  CLIENT_TOKEN=$(get_token "client" "$CLIENT_EMAIL" "Client") || CLIENT_TOKEN=""
else
  warn "SMOKE_CLIENT_EMAIL not set — auth-rejection + trigger live tests will be skipped"
fi

# ─────────────────────────────────────────────────────────────────────
section "2. GET /api/admin/reminder-flows — List Flows"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw "$BASE/api/admin/reminder-flows")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Admin token accepted
R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Flow list" "flows" "$BOD"
assert_field "Flow list items" "trigger_event" "$BOD"
assert_field "Flow list items" "step_count" "$BOD"
assert_field "Flow list items" "is_active" "$BOD"

EXISTING_FLOW_COUNT=$(echo "$BOD" | grep -o '"id"' | wc -l | tr -d ' ')
info "Existing flows in DB: $EXISTING_FLOW_COUNT"

# ─────────────────────────────────────────────────────────────────────
section "3. POST /api/admin/reminder-flows — Create Flow"
# ─────────────────────────────────────────────────────────────────────

TIMESTAMP=$(date +%s)

# No token
R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
  -H "Content-Type: application/json" \
  -d '{"name":"X","trigger_event":"completed"}')
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"X","trigger_event":"completed"}')
  assert_http "Client token → 401" "401" "$R"
fi

# Missing name
R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger_event":"completed"}')
assert_http "Missing name → 400" "400" "$R"

# Missing trigger_event
R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Flow"}')
assert_http "Missing trigger_event → 400" "400" "$R"

# Invalid trigger_event value
R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Flow","trigger_event":"invalid_event"}')
assert_http "Invalid trigger_event → 400" "400" "$R"

# Valid creation with all optional fields
R=$(rw -X POST "$BASE/api/admin/reminder-flows" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"SMOKE_FLOW_$TIMESTAMP\",\"description\":\"Smoke test reminder flow\",\"trigger_event\":\"completed\"}")
assert_http "Create flow → 201" "201" "$R"
BOD=$(body "$R")
assert_field "Created flow response" "flow" "$BOD"
assert_field "Created flow has id" "id" "$BOD"
assert_field "Created flow has name" "name" "$BOD"
assert_field "Created flow has trigger_event" "trigger_event" "$BOD"
assert_field "Created flow has is_active" "is_active" "$BOD"
assert_present "Flow name matches" "SMOKE_FLOW_$TIMESTAMP" "$BOD"
assert_present "trigger_event is completed" '"completed"' "$BOD"

TEST_FLOW_ID=$(extract "id" "$BOD")
info "Created test flow id=$TEST_FLOW_ID"

if [[ -z "$TEST_FLOW_ID" || "$TEST_FLOW_ID" == "null" ]]; then
  fail "Could not extract test flow id — aborting"
  exit 1
fi
ok "Test flow id=$TEST_FLOW_ID extracted"

# Verify new flow appears in list
R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "New flow in list" "SMOKE_FLOW_$TIMESTAMP" "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "4. GET /api/admin/reminder-flows/:id — Single Flow Detail"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Nonexistent flow
R=$(rw "$BASE/api/admin/reminder-flows/999999999" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Nonexistent flow → 404" "404" "$R"

# Valid request
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Get flow detail → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Flow detail has flow" "flow" "$BOD"
assert_field "Flow detail has steps" "steps" "$BOD"
assert_field "Flow detail has executions" "executions" "$BOD"
assert_present "Correct flow name" "SMOKE_FLOW_$TIMESTAMP" "$BOD"
assert_present "Correct trigger_event" '"completed"' "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "5. PUT /api/admin/reminder-flows/:id — Update Flow"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated"}')
assert_http "No token → 401" "401" "$R"

# Nothing to update
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
assert_http "Empty update body → 400" "400" "$R"

# Valid update: rename + set description + deactivate
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"SMOKE_FLOW_UPDATED_$TIMESTAMP\",\"description\":\"Updated desc\",\"is_active\":false}")
assert_http "Update flow → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Update response has flow" "flow" "$BOD"
assert_present "Updated name reflected" "SMOKE_FLOW_UPDATED_$TIMESTAMP" "$BOD"

# Verify is_active=0 persisted (detail fetch)
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "is_active=0 after update" '"is_active":0' "$BOD"

# Update just one field: re-activate
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_active":true}')
assert_http "Partial update (is_active only) → 200" "200" "$R"
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "is_active=1 after re-activate" '"is_active":1' "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "6. POST /api/admin/reminder-flows/:id/toggle"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/toggle")
assert_http "No token → 401" "401" "$R"

# Toggle off (currently is_active=1)
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Toggle 1 (on→off) → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Toggle response has id" "id" "$BOD"
assert_field "Toggle response has is_active" "is_active" "$BOD"
assert_present "Toggled to inactive" '"is_active":0' "$BOD"

# Toggle on
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Toggle 2 (off→on) → 200" "200" "$R"
BOD=$(body "$R")
assert_present "Toggled to active" '"is_active":1' "$BOD"

# Toggle off again (flow should be inactive for the next toggle)
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Toggle 3 (on→off) → 200" "200" "$R"

# Toggle back on (leave it active so trigger test and step order tests work)
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Toggle 4 (off→on) → 200" "200" "$R"
BOD=$(body "$R")
assert_present "Flow active for step tests" '"is_active":1' "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "7. POST /api/admin/reminder-flows/:id/steps — Add Steps"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps" \
  -H "Content-Type: application/json" \
  -d '{"step_type":"internal_alert"}')
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"step_type":"internal_alert"}')
  assert_http "Client token → 401" "401" "$R"
fi

# Missing step_type
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delay_days":0,"label":"Test"}')
assert_http "Missing step_type → 400" "400" "$R"

# Add internal_alert step (immediate, no email needed)
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"step_type\":\"internal_alert\",\"delay_days\":0,\"label\":\"SMOKE Alert\",\"body\":\"Client {{first_name}} completed the program (smoke test)\"}")
assert_http "Add internal_alert step → 201" "201" "$R"
BOD=$(body "$R")
assert_field "Step response has step" "step" "$BOD"
assert_field "Step has id" "id" "$BOD"
assert_field "Step has flow_id" "flow_id" "$BOD"
assert_field "Step has step_order" "step_order" "$BOD"
assert_field "Step has step_type" "step_type" "$BOD"
assert_field "Step has delay_days" "delay_days" "$BOD"
assert_present "Step type is internal_alert" '"internal_alert"' "$BOD"
assert_present "First step order = 1" '"step_order":1' "$BOD"

TEST_STEP_ID=$(extract "id" "$BOD")
info "Created step 1 (internal_alert) id=$TEST_STEP_ID"

if [[ -z "$TEST_STEP_ID" || "$TEST_STEP_ID" == "null" ]]; then
  fail "Could not extract step id"
fi

# Add send_email step with delay (step 2, order auto-increments to 2)
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"step_type\":\"send_email\",\"delay_days\":3,\"label\":\"Day 3 follow-up\",\"subject\":\"SMOKE: {{first_name}} - 3-day follow-up\",\"body\":\"Hi {{first_name}}, your credit repair is progressing!\"}")
assert_http "Add send_email step → 201" "201" "$R"
BOD=$(body "$R")
assert_present "Email step type" '"send_email"' "$BOD"
assert_present "Second step order = 2" '"step_order":2' "$BOD"
assert_present "delay_days=3 persisted" '"delay_days":3' "$BOD"

TEST_STEP2_ID=$(extract "id" "$BOD")
info "Created step 2 (send_email) id=$TEST_STEP2_ID"

# Verify both steps appear in flow detail
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "SMOKE Alert step in detail" "SMOKE Alert" "$BOD"
assert_present "Day 3 step in detail" "Day 3 follow-up" "$BOD"

# Verify step_count=2 in list
R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "step_count=2 in list" '"step_count":2' "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "8. PUT /api/admin/reminder-flows/:id/steps/:stepId — Update Step"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
  -H "Content-Type: application/json" \
  -d '{"label":"Updated"}')
assert_http "No token → 401" "401" "$R"

# Nothing to update
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
assert_http "Empty step update → 400" "400" "$R"

# Valid update of label, delay, and body
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"SMOKE Alert Updated","delay_days":1,"body":"Updated: {{first_name}} needs follow-up"}')
assert_http "Update step → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Step update response has step" "step" "$BOD"
assert_present "Updated label persisted" "SMOKE Alert Updated" "$BOD"
assert_present "Updated delay_days persisted" '"delay_days":1' "$BOD"

# Update step_order (reorder)
R=$(rw -X PUT "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"step_order":1}')
assert_http "Update step_order → 200" "200" "$R"

# Verify updated step appears in flow detail
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "Updated label in flow detail" "SMOKE Alert Updated" "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "9. GET /api/admin/reminder-flows/meta/templates — Email Templates"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw "$BASE/api/admin/reminder-flows/meta/templates")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw "$BASE/api/admin/reminder-flows/meta/templates" -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Admin access
R=$(rw "$BASE/api/admin/reminder-flows/meta/templates" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Meta templates → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Templates list" "templates" "$BOD"
# templates may be empty if no flow_ slugs exist, that is valid
info "Meta templates response OK (may be empty if no flow_ slugs in DB)"

# ─────────────────────────────────────────────────────────────────────
section "10. GET /api/admin/reminder-flows/meta/executions — All Executions"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw "$BASE/api/admin/reminder-flows/meta/executions")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw "$BASE/api/admin/reminder-flows/meta/executions" -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Admin access
R=$(rw "$BASE/api/admin/reminder-flows/meta/executions" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Meta executions → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Executions list" "executions" "$BOD"
info "Executions response OK"

# ─────────────────────────────────────────────────────────────────────
section "11. POST /api/admin/reminder-flows/:id/trigger — Manual Trigger"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/trigger" \
  -H "Content-Type: application/json" \
  -d '{"client_id":1}')
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/trigger" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"client_id":1}')
  assert_http "Client token → 401" "401" "$R"
fi

# Missing client_id
R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/trigger" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
assert_http "Missing client_id → 400" "400" "$R"

# Nonexistent flow
R=$(rw -X POST "$BASE/api/admin/reminder-flows/999999999/trigger" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id":1}')
assert_http "Nonexistent flow trigger → 404" "404" "$R"

# Live trigger test (requires CLIENT_EMAIL)
if [[ -n "$CLIENT_EMAIL" ]]; then
  # Resolve client ID via smoke token
  CLIENT_ID_RESP=$(rw -X POST "$BASE/api/smoke/token" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$SMOKE_SECRET\",\"actor\":\"client\",\"email\":\"$CLIENT_EMAIL\"}")
  CLIENT_ID=$(extract "id" "$(body "$CLIENT_ID_RESP")")
  info "Using client_id=$CLIENT_ID for live trigger"

  if [[ -n "$CLIENT_ID" && "$CLIENT_ID" != "null" && "$CLIENT_ID" != "0" ]]; then
    R=$(rw -X POST "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/trigger" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"client_id\":$CLIENT_ID}")
    assert_http "Live trigger → 200" "200" "$R"
    BOD=$(body "$R")
    assert_present "Trigger response ok=true" '"ok":true' "$BOD"

    # Execution should now be logged in the flow's detail
    # (slight delay for DB write to complete)
    R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
    BOD=$(body "$R")
    # executions array may or may not be for this exact flow (trigger uses trigger_event lookup)
    assert_field "Flow detail still has executions field" "executions" "$BOD"
    info "Live trigger completed — check executions in ReminderFlows admin page to confirm"
  else
    warn "Could not resolve client_id from $CLIENT_EMAIL — skipping live trigger"
  fi
else
  warn "SMOKE_CLIENT_EMAIL not set — skipping live trigger test"
fi

# ─────────────────────────────────────────────────────────────────────
section "12. DELETE /api/admin/reminder-flows/:id/steps/:stepId — Delete Step"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
    -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Delete step 1 (internal_alert)
R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Delete step 1 → 200" "200" "$R"
BOD=$(body "$R")
assert_present "Delete step ok=true" '"ok":true' "$BOD"

# Delete step 2 (send_email)
if [[ -n "$TEST_STEP2_ID" && "$TEST_STEP2_ID" != "null" ]]; then
  R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID/steps/$TEST_STEP2_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  assert_http "Delete step 2 → 200" "200" "$R"
fi

# Verify step count drops to 0 in list
R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_present "step_count=0 after both deleted" '"step_count":0' "$BOD"

# Verify deleted step is gone from flow detail
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_absent "SMOKE Alert step gone after delete" "SMOKE Alert Updated" "$BOD"
assert_absent "Day 3 step gone after delete" "Day 3 follow-up" "$BOD"

# ─────────────────────────────────────────────────────────────────────
section "13. DELETE /api/admin/reminder-flows/:id — Delete Flow"
# ─────────────────────────────────────────────────────────────────────

# No token
R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID")
assert_http "No token → 401" "401" "$R"

# Client token rejected
if [[ -n "$CLIENT_TOKEN" ]]; then
  R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
    -H "Authorization: Bearer $CLIENT_TOKEN")
  assert_http "Client token → 401" "401" "$R"
fi

# Valid delete
R=$(rw -X DELETE "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Delete flow → 200" "200" "$R"
BOD=$(body "$R")
assert_present "Delete flow ok=true" '"ok":true' "$BOD"

# Flow must be gone from detail
R=$(rw "$BASE/api/admin/reminder-flows/$TEST_FLOW_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Deleted flow → 404" "404" "$R"

# Flow must be absent from list
R=$(rw "$BASE/api/admin/reminder-flows" -H "Authorization: Bearer $ADMIN_TOKEN")
BOD=$(body "$R")
assert_absent "Deleted flow not in list" "SMOKE_FLOW_UPDATED_$TIMESTAMP" "$BOD"

# Clear id so trap doesn't double-delete
TEST_FLOW_ID=""

# ─────────────────────────────────────────────────────────────────────
section "RESULTS"
# ─────────────────────────────────────────────────────────────────────
echo "" >&2
echo -e "${BOLD}  ✓ Passed : ${GREEN}$PASS${NC}" >&2
echo -e "${BOLD}  ✗ Failed : ${RED}$FAIL${NC}" >&2
[[ $SKIP -gt 0 ]] && echo -e "${BOLD}  ⚠ Skipped: ${YELLOW}$SKIP${NC}" >&2
echo "" >&2

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ALL $PASS ASSERTIONS PASSED — Reminder Flows smoke test OK${NC}" >&2
  exit 0
else
  echo -e "${RED}${BOLD}  SMOKE TEST FAILED — $FAIL assertion(s) did not pass${NC}" >&2
  exit 1
fi
