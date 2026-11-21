#!/usr/bin/env bash
# Verifies the InsightHub monitoring endpoints.
#   BASE_URL            default http://localhost:5000
#   METRICS_TOKEN       default: read from backend/.env
#   STORAGE_FAILURE_TEST=1   start a throwaway backend (port 5099, temp DATA_DIR), delete the dir, expect 503
#   CHROMA_CONTAINER=name    docker stop/start that container and expect 503 then 200
#   CHECK_PORT_8000=1        show docker port / compose ps for ChromaDB (needs docker)
cd "$(dirname "$0")/.." || exit 1
BASE_URL="${BASE_URL:-http://localhost:5000}"
if [ -z "$METRICS_TOKEN" ] && [ -f backend/.env ]; then
  METRICS_TOKEN="$(grep -E '^METRICS_TOKEN=' backend/.env | head -1 | cut -d= -f2- | tr -d '\r')"
fi
[ -z "$METRICS_TOKEN" ] && { echo "METRICS_TOKEN not set"; exit 2; }
EXPECTED_HEALTH='{"status":"ok","message":"InsightHub Backend & Vector Gateway is running."}'
FAIL=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAIL=1; }
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
auth=(-H "Authorization: Bearer $METRICS_TOKEN")
expect_code() { # label expected curl-args...
  local label="$1" want="$2"; shift 2
  local got; got="$(code "$@")"
  [ "$got" = "$want" ] && pass "$label -> $got" || fail "$label -> $got (want $want)"
}
metric() { # name -> sum of values for lines starting with name (labels ignored)
  curl -s -m 15 "${auth[@]}" "$BASE_URL/metrics" | awk -v n="$1" '$1==n || index($1,n"{")==1 {s+=$2} END{printf "%.3f", s+0}'
}

echo "== 1. /api/health unchanged"
body="$(curl -s -m 10 "$BASE_URL/api/health")"; echo "  $body"
[ "$body" = "$EXPECTED_HEALTH" ] && pass "same response as recorded" || fail "response differs"

echo "== 2. /metrics auth"
expect_code "no token" 401 "$BASE_URL/metrics"
expect_code "wrong token" 401 -H "Authorization: Bearer wrong-token" "$BASE_URL/metrics"
expect_code "correct token" 200 "${auth[@]}" "$BASE_URL/metrics"

echo "== 3. counters move after traffic"
s0="$(metric insighthub_http_requests_success_total)"; f0="$(metric insighthub_http_requests_failed_total)"; t0="$(metric insighthub_last_request_timestamp_seconds)"
sleep 1
curl -s -o /dev/null "$BASE_URL/api/search-history"                 # success
curl -s -o /dev/null "$BASE_URL/api/does-not-exist-$$"              # 404
s1="$(metric insighthub_http_requests_success_total)"; f1="$(metric insighthub_http_requests_failed_total)"; t1="$(metric insighthub_last_request_timestamp_seconds)"
echo "  success_total $s0 -> $s1 | failed_total $f0 -> $f1 | last_request_ts $t0 -> $t1"
awk -v a="$s0" -v b="$s1" 'BEGIN{exit !(b>a)}'  && pass "success counter increased" || fail "success counter flat"
awk -v a="$f0" -v b="$f1" 'BEGIN{exit !(b>a)}'  && pass "failed counter increased" || fail "failed counter flat"
awk -v a="$t0" -v b="$t1" 'BEGIN{exit !(b>a)}' && pass "timestamp advanced" || fail "timestamp flat"
# labelled series only exist after the first counted request, so check names after the traffic above
m="$(curl -s -m 15 "${auth[@]}" "$BASE_URL/metrics")"
for n in insighthub_http_requests_total insighthub_http_request_duration_seconds_bucket insighthub_last_request_timestamp_seconds insighthub_storage_up insighthub_chromadb_up; do
  echo "$m" | grep -q "^$n" && pass "contains $n" || fail "missing $n"
done
curl -s -m 15 "${auth[@]}" "$BASE_URL/metrics" | grep -E 'insighthub_http_requests_total\{.*(unmatched|search-history)' | sed 's/^/  /'

echo "== 4. storage"
curl -s -m 10 "${auth[@]}" "$BASE_URL/api/health/storage" -w '  [HTTP %{http_code}]\n'
expect_code "storage" 200 "${auth[@]}" "$BASE_URL/api/health/storage"
if [ "$STORAGE_FAILURE_TEST" = "1" ]; then
  T="$(mktemp -d)"; P=5099; B="http://localhost:$P"
  if curl -s -o /dev/null -m 2 "$B/api/health"; then fail "port $P already in use; stop it and re-run"; exit 1; fi
  ( cd backend && PORT=$P DATA_DIR="$T" METRICS_TOKEN="$METRICS_TOKEN" node server.js >/dev/null 2>&1 & echo $! > "$T.pid" )
  for i in $(seq 1 30); do curl -s -o /dev/null "$B/api/health" && break; sleep 1; done
  expect_code "temp instance storage" 200 "${auth[@]}" "$B/api/health/storage"
  rm -rf "$T"
  curl -s -m 10 "${auth[@]}" "$B/api/health/storage" -w '  [HTTP %{http_code}]\n'
  expect_code "storage after DATA_DIR removed" 503 "${auth[@]}" "$B/api/health/storage"
  kill "$(cat "$T.pid")" 2>/dev/null
  # Git Bash on Windows cannot kill native node by MSYS pid; fall back to the owner of the port.
  if curl -s -o /dev/null -m 2 "$B/api/health" && command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
  fi
  rm -f "$T.pid"
else
  echo "  (skipped missing-DATA_DIR test; set STORAGE_FAILURE_TEST=1)"
fi

echo "== 5. chromadb"
curl -s -m 10 "${auth[@]}" "$BASE_URL/api/health/chromadb" -w '  [HTTP %{http_code}]\n'
if [ -n "$CHROMA_CONTAINER" ]; then
  expect_code "chromadb up" 200 "${auth[@]}" "$BASE_URL/api/health/chromadb"
  docker stop "$CHROMA_CONTAINER" >/dev/null
  expect_code "chromadb stopped" 503 "${auth[@]}" "$BASE_URL/api/health/chromadb"
  docker start "$CHROMA_CONTAINER" >/dev/null; sleep 5
  expect_code "chromadb restarted" 200 "${auth[@]}" "$BASE_URL/api/health/chromadb"
else
  echo "  (skipped stop/start test; set CHROMA_CONTAINER=<container name>)"
fi
echo "  combined:"; curl -s -m 15 "${auth[@]}" "$BASE_URL/api/health/monitoring" -w '\n  [HTTP %{http_code}]\n'

echo "== 6. ChromaDB port 8000 not published publicly"
if [ "$CHECK_PORT_8000" = "1" ]; then
  docker compose ps; docker port "${CHROMA_CONTAINER:-chromadb}" 2>&1 || true
else
  echo "  (skipped; set CHECK_PORT_8000=1 with docker running)"
fi
[ "$FAIL" = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
