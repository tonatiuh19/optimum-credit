#!/usr/bin/env bash
# =====================================================================
#  Support FAQ & Tickets — Full Smoke Test
#  Requires the dev server to be running: npm run dev
#
#  Env vars (read from .env automatically or set in shell):
#    SMOKE_TEST_SECRET   — must match the value in .env
#    SMOKE_ADMIN_EMAIL   — an active admin email (default: first admin)
#    SMOKE_CLIENT_EMAIL  — an active client email (default: first client)
#    BASE                — server base URL (default: https://localhost:8080)
#
#  Usage:
#    chmod +x scripts/smoke-test-support.sh
#    ./scripts/smoke-test-support.sh
# =====================================================================

set -euo pipefail

# ── Load .env ────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  while read -r line; do
    # skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    # must contain an =
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    # skip keys with spaces or special chars
    [[ "$key" =~ [^A-Za-z0-9_] ]] && continue
    # strip surrounding quotes from value
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
ADMIN_TOKEN=""; CLIENT_TOKEN=""
TEST_FAQ_ID=""; TEST_TICKET_ID=""

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

# ── curl helpers ──────────────────────────────────────────────────────
# rw: body + newline + status_code
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
    fail "$label → expected $want, got $got"
    info "    $(echo "$bod" | head -c 300)"
  fi
}

assert_field() {
  local label="$1" field="$2" bod="$3"
  if echo "$bod" | grep -q "\"$field\""; then
    ok "$label has field '$field'"
  else
    fail "$label missing field '$field'"
    info "    $(echo "$bod" | head -c 300)"
  fi
}

assert_absent() {
  local label="$1" pat="$2" bod="$3"
  if echo "$bod" | grep -q "$pat"; then
    fail "$label must NOT contain '$pat'"
    info "    $(echo "$bod" | grep -o ".\{0,80\}$pat.\{0,80\}" | head -1)"
  else
    ok "$label: '$pat' absent (as expected)"
  fi
}

assert_present() {
  local label="$1" pat="$2" bod="$3"
  if echo "$bod" | grep -q "$pat"; then
    ok "$label contains '$pat'"
  else
    fail "$label missing '$pat'"
    info "    $(echo "$bod" | head -c 300)"
  fi
}

extract() {
  # extract_json_value field body
  echo "$2" | grep -o "\"$1\":[^,}]*" | head -1 | sed 's/.*: *//; s/[",}]//g; s/ //g'
}

# ── Preflight: SMOKE_TEST_SECRET ─────────────────────────────────────
section "0. Preflight"

if [[ -z "$SMOKE_SECRET" ]]; then
  fail "SMOKE_TEST_SECRET not set — add it to .env and restart the server"
  echo ""
  echo "  echo 'SMOKE_TEST_SECRET=smoke-secret-change-me' >> .env"
  echo ""
  exit 1
fi
ok "SMOKE_TEST_SECRET is configured"

# ── Dev server lifecycle helper ───────────────────────────────────────
kill_dev_server() {
  pkill -f "vite"    2>/dev/null || true
  pkill -f "ts-node" 2>/dev/null || true
  pkill -f "nodemon" 2>/dev/null || true
  lsof -ti:8080,8081 2>/dev/null | xargs kill -9 2>/dev/null || true
}

# ── Start dev server ─────────────────────────────────────────────────
info "Killing any stale dev server processes…"
kill_dev_server
sleep 0.5

info "Starting dev server (npm run dev)…"
npm run dev > /tmp/smoke-support-dev.log 2>&1 &
DEV_PID=$!

SERVER_READY=0
for i in {1..20}; do
  sleep 1
  HCODE=$(curl -sk --connect-timeout 3 --max-time 5 \
    -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || true)
  if [[ "$HCODE" == "200" ]]; then SERVER_READY=1; break; fi
done

if [[ "$SERVER_READY" -eq 0 ]]; then
  fail "Dev server failed to start within 20s (check /tmp/smoke-support-dev.log)"
  exit 1
fi
ok "Dev server started (PID=$DEV_PID, HTTP 200)"

# Kill dev server on exit
trap 'info "Killing dev server…" >&2; kill_dev_server' EXIT

# ── Smoke auth: get admin token ───────────────────────────────────────
section "1. Smoke Authentication"

get_token() {
  local actor="$1" email="$2" label="$3"
  info "Getting $label token for <$email>…"
  local R
  R=$(rw -X POST "$BASE/api/smoke/token" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$SMOKE_SECRET\",\"actor\":\"$actor\",\"email\":\"$email\"}")
  local code; code=$(code "$R")
  local bod; bod=$(body "$R")
  if [[ "$code" != "200" ]]; then
    fail "$label: smoke/token returned HTTP $code"
    info "    $bod"
    return 1
  fi
  local token; token=$(extract "token" "$bod")
  if [[ -z "$token" ]]; then
    fail "$label: no token in response"
    info "    $bod"
    return 1
  fi
  ok "$label: authenticated (token length=${#token})"
  echo "$token"
}

# If emails not configured, try to discover them from the server (admin/me guard)
if [[ -z "$ADMIN_EMAIL" ]]; then
  warn "SMOKE_ADMIN_EMAIL not set — set it in .env (e.g. SMOKE_ADMIN_EMAIL=admin@example.com)"
  ((FAIL++))
  ADMIN_TOKEN=""
else
  ADMIN_TOKEN=$(get_token "admin" "$ADMIN_EMAIL" "Admin") || ADMIN_TOKEN=""
fi

if [[ -z "$CLIENT_EMAIL" ]]; then
  warn "SMOKE_CLIENT_EMAIL not set — set it in .env (e.g. SMOKE_CLIENT_EMAIL=client@example.com)"
  ((FAIL++))
  CLIENT_TOKEN=""
else
  CLIENT_TOKEN=$(get_token "client" "$CLIENT_EMAIL" "Client") || CLIENT_TOKEN=""
fi

if [[ -z "$ADMIN_TOKEN" || -z "$CLIENT_TOKEN" ]]; then
  fail "Cannot proceed without both tokens — aborting remaining tests"
  echo ""
  echo -e "${BOLD}Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
  exit 1
fi

# ── Section 2: Portal FAQ (client-only) ──────────────────────────────
section "2. GET /api/portal/support-faq"

R=$(rw "$BASE/api/portal/support-faq")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/portal/support-faq" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token on portal route → 401" "401" "$R"

R=$(rw "$BASE/api/portal/support-faq" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Portal FAQ response" "faqs" "$BOD"
# Portal must NOT expose is_active
assert_absent "Portal FAQ: no is_active column leaked" "\"is_active\"" "$BOD"
FAQ_COUNT=$(echo "$BOD" | grep -o '"id"' | wc -l | tr -d ' ')
ok "Portal FAQ: $FAQ_COUNT active FAQ(s) returned"

# ── Section 3: Admin FAQ GET ─────────────────────────────────────────
section "3. GET /api/admin/support-faq"

R=$(rw "$BASE/api/admin/support-faq")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/support-faq" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token on admin route → 401" "401" "$R"

R=$(rw "$BASE/api/admin/support-faq" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token → 200" "200" "$R"
BOD=$(body "$R")
assert_field "Admin FAQ list" "faqs" "$BOD"
# Admin response includes is_active
assert_present "Admin FAQ: is_active field present" "\"is_active\"" "$BOD"
ADMIN_FAQ_COUNT=$(echo "$BOD" | grep -o '"id"' | wc -l | tr -d ' ')
ok "Admin FAQ: $ADMIN_FAQ_COUNT total FAQ(s) (active + inactive)"

# ── Section 4: Admin FAQ CREATE ───────────────────────────────────────
section "4. POST /api/admin/support-faq"

R=$(rw -X POST "$BASE/api/admin/support-faq" \
  -H "Content-Type: application/json" \
  -d '{"question":"Smoke?","answer":"Yes."}')
assert_http "No token → 401" "401" "$R"

R=$(rw -X POST "$BASE/api/admin/support-faq" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"answer":"Missing question"}')
assert_http "Missing question → 400" "400" "$R"
assert_present "400 body mentions question" "question" "$(body "$R")"

R=$(rw -X POST "$BASE/api/admin/support-faq" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Missing answer"}')
assert_http "Missing answer → 400" "400" "$R"

R=$(rw -X POST "$BASE/api/admin/support-faq" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"[SMOKE] What is this?\",\"answer\":\"This is a smoke test FAQ created by the CI smoke script.\",\"category\":\"technical\",\"sort_order\":9999,\"is_active\":false}")
assert_http "Create FAQ → 200" "200" "$R"
TEST_FAQ_ID=$(extract "id" "$(body "$R")")
if [[ -n "$TEST_FAQ_ID" && "$TEST_FAQ_ID" =~ ^[0-9]+$ ]]; then
  ok "Created FAQ id=$TEST_FAQ_ID"
else
  fail "Could not extract FAQ id from response"
  info "    $(body "$R")"
  TEST_FAQ_ID=""
fi

# Verify it's visible in the admin list but NOT in the portal list (is_active=false)
R=$(rw "$BASE/api/admin/support-faq" -H "Authorization: Bearer $ADMIN_TOKEN")
if [[ -n "$TEST_FAQ_ID" ]] && echo "$(body "$R")" | grep -q "\"id\":$TEST_FAQ_ID"; then
  ok "Created FAQ appears in admin list"
else
  fail "Created FAQ NOT found in admin list"
fi

R=$(rw "$BASE/api/portal/support-faq" -H "Authorization: Bearer $CLIENT_TOKEN")
if [[ -n "$TEST_FAQ_ID" ]] && echo "$(body "$R")" | grep -q "\"id\":$TEST_FAQ_ID"; then
  fail "Inactive FAQ leaked to portal list (is_active=false should be hidden)"
else
  ok "Inactive FAQ correctly hidden from portal"
fi

# ── Section 5: Admin FAQ UPDATE ───────────────────────────────────────
section "5. PUT /api/admin/support-faq/:id"

if [[ -z "$TEST_FAQ_ID" ]]; then
  warn "Skipping PUT — no FAQ id from CREATE step"
else
  R=$(rw -X PUT "$BASE/api/admin/support-faq/$TEST_FAQ_ID" \
    -H "Content-Type: application/json" \
    -d '{"question":"Updated"}')
  assert_http "No token → 401" "401" "$R"

  R=$(rw -X PUT "$BASE/api/admin/support-faq/$TEST_FAQ_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"question\":\"[SMOKE] Updated question?\",\"is_active\":true}")
  assert_http "Update FAQ → 200" "200" "$R"
  assert_present "Update response ok=true" "\"ok\":true" "$(body "$R")"

  # Verify update persisted and FAQ is now visible to portal
  R=$(rw "$BASE/api/admin/support-faq" -H "Authorization: Bearer $ADMIN_TOKEN")
  UPDATED_BOD=$(body "$R")
  if echo "$UPDATED_BOD" | grep -q "\[SMOKE\] Updated question?"; then
    ok "Updated question persisted in DB"
  else
    fail "Updated question not found in admin list after PUT"
  fi

  R=$(rw "$BASE/api/portal/support-faq" -H "Authorization: Bearer $CLIENT_TOKEN")
  if echo "$(body "$R")" | grep -q "\"id\":$TEST_FAQ_ID"; then
    ok "Activated FAQ now visible in portal"
  else
    fail "Activated FAQ not visible in portal after is_active=true"
  fi
fi

# ── Section 6: Admin FAQ DELETE ───────────────────────────────────────
section "6. DELETE /api/admin/support-faq/:id"

if [[ -z "$TEST_FAQ_ID" ]]; then
  warn "Skipping DELETE — no FAQ id from CREATE step"
else
  R=$(rw -X DELETE "$BASE/api/admin/support-faq/$TEST_FAQ_ID")
  assert_http "No token → 401" "401" "$R"

  R=$(rw -X DELETE "$BASE/api/admin/support-faq/$TEST_FAQ_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  assert_http "Delete FAQ → 200" "200" "$R"
  assert_present "Delete response ok=true" "\"ok\":true" "$(body "$R")"

  # Verify deletion
  R=$(rw "$BASE/api/admin/support-faq" -H "Authorization: Bearer $ADMIN_TOKEN")
  if echo "$(body "$R")" | grep -q "\"id\":$TEST_FAQ_ID"; then
    fail "Deleted FAQ still appears in admin list"
  else
    ok "Deleted FAQ no longer in admin list"
  fi

  R=$(rw "$BASE/api/portal/support-faq" -H "Authorization: Bearer $CLIENT_TOKEN")
  if echo "$(body "$R")" | grep -q "\"id\":$TEST_FAQ_ID"; then
    fail "Deleted FAQ still visible in portal"
  else
    ok "Deleted FAQ not in portal list"
  fi

  TEST_FAQ_ID="" # Already deleted — skip cleanup
fi

# ── Section 7: Portal Tickets ─────────────────────────────────────────
section "7. GET /api/portal/tickets"

R=$(rw "$BASE/api/portal/tickets")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/portal/tickets" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token on portal route → 401" "401" "$R"

R=$(rw "$BASE/api/portal/tickets" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 200" "200" "$R"
assert_field "Tickets list response" "tickets" "$(body "$R")"

# ── Section 8: Create Ticket ──────────────────────────────────────────
section "8. POST /api/portal/tickets"

R=$(rw -X POST "$BASE/api/portal/tickets" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","body":"Test"}')
assert_http "No token → 401" "401" "$R"

R=$(rw -X POST "$BASE/api/portal/tickets" \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
assert_http "Empty body → 400" "400" "$R"
assert_present "Error mentions subject" "ubject" "$(body "$R")"

R=$(rw -X POST "$BASE/api/portal/tickets" \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"subject\":\"[SMOKE] Test ticket\",\"body\":\"Smoke test ticket body created by CI smoke script.\",\"category\":\"billing\",\"priority\":\"high\"}")
assert_http "Create ticket → 200" "200" "$R"
TEST_TICKET_ID=$(extract "id" "$(body "$R")")
if [[ -n "$TEST_TICKET_ID" && "$TEST_TICKET_ID" =~ ^[0-9]+$ ]]; then
  ok "Created ticket id=$TEST_TICKET_ID"
else
  fail "Could not extract ticket id from response"
  info "    $(body "$R")"
  TEST_TICKET_ID=""
fi

# ── Section 9: Reply to Ticket (Portal) ──────────────────────────────
section "9. POST /api/portal/tickets/:id/replies"

if [[ -z "$TEST_TICKET_ID" ]]; then
  warn "Skipping replies — no ticket id from CREATE step"
else
  R=$(rw -X POST "$BASE/api/portal/tickets/$TEST_TICKET_ID/replies" \
    -H "Content-Type: application/json" \
    -d '{"body":"test"}')
  assert_http "No token → 401" "401" "$R"

  R=$(rw -X POST "$BASE/api/portal/tickets/$TEST_TICKET_ID/replies" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')
  assert_http "Empty body → 400" "400" "$R"

  R=$(rw -X POST "$BASE/api/portal/tickets/$TEST_TICKET_ID/replies" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"[SMOKE] Client reply"}')
  assert_http "Client reply → 200" "200" "$R"
  assert_field "Reply response" "id" "$(body "$R")"

  # Client cannot reply to someone else's ticket
  R=$(rw -X POST "$BASE/api/portal/tickets/999999/replies" \
    -H "Authorization: Bearer $CLIENT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"Unauthorized reply attempt"}')
  assert_http "Reply to nonexistent ticket → 404" "404" "$R"
fi

# ── Section 10: Admin Tickets ─────────────────────────────────────────
section "10. GET /api/admin/tickets"

R=$(rw "$BASE/api/admin/tickets")
assert_http "No token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/tickets" -H "Authorization: Bearer $CLIENT_TOKEN")
assert_http "Client token → 401" "401" "$R"

R=$(rw "$BASE/api/admin/tickets" -H "Authorization: Bearer $ADMIN_TOKEN")
assert_http "Admin token → 200" "200" "$R"
assert_field "Admin tickets list" "tickets" "$(body "$R")"

# ── Section 11: Admin Ticket Detail + Replies ─────────────────────────
section "11. GET /api/admin/tickets/:id + POST replies"

if [[ -z "$TEST_TICKET_ID" ]]; then
  warn "Skipping admin ticket detail — no ticket id"
else
  R=$(rw "$BASE/api/admin/tickets/$TEST_TICKET_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  assert_http "Admin GET ticket detail → 200" "200" "$R"
  BOD=$(body "$R")
  assert_field "Detail has 'ticket'" "ticket" "$BOD"
  assert_field "Detail has 'replies'" "replies" "$BOD"
  assert_present "Detail contains SMOKE subject" "SMOKE" "$BOD"

  R=$(rw -X POST "$BASE/api/admin/tickets/$TEST_TICKET_ID/replies" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"[SMOKE] Admin reply","is_internal_note":false}')
  assert_http "Admin reply → 200" "200" "$R"
  assert_field "Admin reply response" "id" "$(body "$R")"

  R=$(rw -X POST "$BASE/api/admin/tickets/$TEST_TICKET_ID/replies" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"[SMOKE] Internal note","is_internal_note":true}')
  assert_http "Admin internal note → 200" "200" "$R"
fi

# ── Section 12: Ticket Status Updates ────────────────────────────────
section "12. POST /api/admin/tickets/:id/status"

if [[ -z "$TEST_TICKET_ID" ]]; then
  warn "Skipping status updates — no ticket id"
else
  # Invalid status rejected
  R=$(rw -X POST "$BASE/api/admin/tickets/$TEST_TICKET_ID/status" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"invalid_status"}')
  assert_http "Invalid status → 400" "400" "$R"

  for STATUS in in_progress waiting_client resolved closed open; do
    R=$(rw -X POST "$BASE/api/admin/tickets/$TEST_TICKET_ID/status" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$STATUS\"}")
    assert_http "Status update: $STATUS → 200" "200" "$R"
    assert_present "status $STATUS ok=true" "\"ok\":true" "$(body "$R")"
  done
fi

# ── Section 13: Admin GET with Status Filter ──────────────────────────
section "13. Admin ticket filters"

for STATUS in open in_progress waiting_client resolved closed; do
  R=$(rw "$BASE/api/admin/tickets?status=$STATUS" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  assert_http "GET tickets?status=$STATUS → 200" "200" "$R"
  assert_field "Filtered list has tickets" "tickets" "$(body "$R")"
done

# ── Cleanup ───────────────────────────────────────────────────────────
section "14. Cleanup"

CLEANUP_PAYLOAD="{\"secret\":\"$SMOKE_SECRET\""
[[ -n "$TEST_TICKET_ID" ]] && CLEANUP_PAYLOAD+=",\"ticket_id\":$TEST_TICKET_ID"
[[ -n "$TEST_FAQ_ID" ]]    && CLEANUP_PAYLOAD+=",\"faq_id\":$TEST_FAQ_ID"
CLEANUP_PAYLOAD+="}"

R=$(rw -X DELETE "$BASE/api/smoke/cleanup" \
  -H "Content-Type: application/json" \
  -d "$CLEANUP_PAYLOAD")
assert_http "Cleanup → 200" "200" "$R"

# Revoke admin + client sessions
for TOKEN in "$ADMIN_TOKEN" "$CLIENT_TOKEN"; do
  rw -X DELETE "$BASE/api/smoke/cleanup" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$SMOKE_SECRET\",\"session_revoke_token\":\"$TOKEN\"}" > /dev/null
done
ok "Smoke sessions revoked"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  RESULTS${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "  ${GREEN}✓${NC} Passed : ${GREEN}${BOLD}$PASS${NC}"
echo -e "  ${RED}✗${NC} Failed : ${RED}${BOLD}$FAIL${NC}"
[[ $SKIP -gt 0 ]] && echo -e "  ${YELLOW}⚠${NC} Skipped: ${YELLOW}${BOLD}$SKIP${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}${BOLD}SMOKE TEST FAILED — $FAIL assertion(s) did not pass${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}SMOKE TEST PASSED — all $PASS assertions OK${NC}"
  exit 0
fi
