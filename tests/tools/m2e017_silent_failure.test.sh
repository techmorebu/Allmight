#!/bin/bash
# M2E-017A — silent-failure remediation, fixture built from DEPLOYED BYTES.
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$HERE/../../scripts/tools/start_all.sh"; B="$HERE/fixtures/m2e017_baseline_start_all.sh"
pass=0; fail=0
c(){ if [ "$2" = "1" ]; then echo "  OK   $1"; pass=$((pass+1)); else echo "  FAIL $1${3:+  — $3}"; fail=$((fail+1)); fi; }
echo "M2E-017A — shadow silent-failure remediation"; echo "=================================================="

# extract the SHADOW launch block by its unique surrounding context — the file
# has several `(set +e; while true; do` loops and a bare match takes the fetcher's
ext(){ awk '/-- 7\. Shadow execution engine/,/^SHADOW_PID=\$!/' "$1" | sed -n '/^(set +e; while true; do$/,/^done) >> "\$LOG_DIR\/shadow_engine.log"/p'; }

# ── ONE-CYCLE FIXTURE + SELF-PROVING PREFLIGHT ───────────────────────────
mkfix(){ ext "$1" \
  | sed 's/^(set +e; while true; do$/(set +e; for _once in 1; do/' \
  | sed 's/^  sleep 300$/  : # M2E-017A one-cycle: sleep removed/' \
  | sed 's/ 2>&1 &$/ 2>\&1/'; }
preflight(){ # $1=script $2=label — MUST pass before any test runs
  local fx; fx=$(mkfix "$1")
  local bad=0
  if echo "$fx" | grep -qE '^[^#]*\bsleep 300\b'; then echo "  PREFLIGHT FAIL [$2]: an EXECUTABLE sleep 300 survives"; bad=1; fi
  echo "$fx" | grep -q 'shadow_execution_engine.js'    || { echo "  PREFLIGHT FAIL [$2]: v1 engine missing"; bad=1; }
  echo "$fx" | grep -q 'shadow_execution_engine_v2.js' || { echo "  PREFLIGHT FAIL [$2]: v2 engine missing"; bad=1; }
  echo "$fx" | grep -q 'while true'                    && { echo "  PREFLIGHT FAIL [$2]: still an infinite loop"; bad=1; }
  return $bad
}
echo "-- PREFLIGHT: the fixture must be single-cycle and complete --"
preflight "$P" patched  && c "P1 patched fixture: no executable sleep, both engines, single cycle" 1 || { c "P1 patched fixture" 0; echo "passed $pass  failed $((fail))"; exit 1; }
preflight "$B" baseline && c "P2 baseline fixture: same properties" 1 || { c "P2 baseline fixture" 0; echo "passed $pass  failed $((fail))"; exit 1; }

run(){ # $1=script $2=v1_rc $3=v2_rc
  local d; d=$(mktemp -d); mkdir -p "$d/scripts/execution"
  printf "console.error('v1 stderr line'); process.exit(%s);\n" "$2" > "$d/scripts/execution/shadow_execution_engine.js"
  printf "console.error('v2 stderr line'); process.exit(%s);\n" "$3" > "$d/scripts/execution/shadow_execution_engine_v2.js"
  mkfix "$1" > "$d/loop.sh"
  mkdir -p "$d/session_TESTEPOCH"
  ( cd "$d" && REPO="$d" SESSION_DIR="$d/session_TESTEPOCH" LOG_DIR="$d" timeout 20 bash loop.sh ) >/dev/null 2>&1
  sleep 0.3; cat "$d/shadow_engine.log" 2>/dev/null; rm -rf "$d"
}
OK=$(run "$P" 0 0); V1=$(run "$P" 3 0); BOTH=$(run "$P" 3 7); BASE=$(run "$B" 3 0)

echo "-- FAILURE IS NOW VISIBLE --"
c "S3 a v1 non-zero exit is REPORTED"  "$(echo "$V1"   | grep -q 'ENGINE_EXIT engine=v1 rc=3' && echo 1 || echo 0)" "$V1"
c "S4 a v2 non-zero exit is REPORTED"  "$(echo "$BOTH" | grep -q 'ENGINE_EXIT engine=v2 rc=7' && echo 1 || echo 0)" "$BOTH"
c "S5 STDERR is no longer discarded"   "$(echo "$V1"   | grep -q 'v1 stderr line' && echo 1 || echo 0)" "$V1"
c "S6 REGRESSION CONTROL: the BASELINE reported NOTHING for the same failure" \
  "$([ -z "$(echo "$BASE" | grep -E 'ENGINE_EXIT|v1 stderr line')" ] && echo 1 || echo 0)" "$BASE"
c "S7 DISCRIMINATION: patched != baseline on identical input" "$([ "$V1" != "$BASE" ] && echo 1 || echo 0)"

echo "-- SESSION IDENTITY + TIME-001 --"
c "S20 the v1 failure record carries the SESSION" \
  "$(echo "$V1" | grep -q 'ENGINE_EXIT engine=v1 .*session=session_TESTEPOCH' && echo 1 || echo 0)" "$V1"
c "S21 the v2 failure record carries the SESSION" \
  "$(echo "$BOTH" | grep -q 'ENGINE_EXIT engine=v2 .*session=session_TESTEPOCH' && echo 1 || echo 0)" "$BOTH"
c "S22 TIME-001: the ts is UTC with a Z suffix, no local offset" \
  "$(echo "$V1" | grep -qE 'ts=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' && echo 1 || echo 0)" "$V1"
c "S22-CONTROL no local-offset timestamp is emitted" \
  "$(echo "$V1" | grep -qE 'ts=[0-9T:-]+[+-][0-9]{2}:[0-9]{2}' && echo 0 || echo 1)" "$V1"
c "S23 the record carries ALL FOUR fields: engine, rc, session, ts" \
  "$(echo "$V1" | grep -qE 'ENGINE_EXIT engine=v1 rc=3 session=session_TESTEPOCH ts=[0-9]{4}-.*Z' && echo 1 || echo 0)" "$V1"
c "S24 CONTROL: the BASELINE emits no session-bearing record at all" \
  "$(echo "$BASE" | grep -q 'session=' && echo 0 || echo 1)" "$BASE"

echo "-- INDEPENDENCE PRESERVED --"
c "S8 v2 STILL RUNS when v1 fails" "$(echo "$BOTH" | grep -q 'v2 stderr line' && echo 1 || echo 0)" "$BOTH"
c "S9 both failures reported in ONE cycle" "$([ "$(echo "$BOTH" | grep -c 'ENGINE_EXIT')" = "2" ] && echo 1 || echo 0)" "$BOTH"

echo "-- SUCCESS IS QUIET --"
c "S10 a clean cycle emits NO ENGINE_EXIT" "$([ -z "$(echo "$OK" | grep 'ENGINE_EXIT')" ] && echo 1 || echo 0)" "$OK"
c "S10-CONTROL the clean run DID execute both engines" \
  "$(echo "$OK" | grep -q 'v1 stderr line' && echo "$OK" | grep -q 'v2 stderr line' && echo 1 || echo 0)" "$OK"

echo "-- THE WRAPPER STAYS VIABLE --"
c "S11 no 'set -e' introduced"   "$(ext "$P" | grep -qE '^\s*set -e' && echo 0 || echo 1)"
c "S12 'set +e' preserved"       "$(ext "$P" | grep -q 'set +e' && echo 1 || echo 0)"
c "S13 loop ends with unconditional true" "$(ext "$P" | grep -qE '^\s+true\s' && echo 1 || echo 0)"
c "S14 sleep 300 is STILL FIRST" "$(ext "$P" | sed -n '2p' | grep -q 'sleep 300' && echo 1 || echo 0)"

echo "-- THE SILENCING IS GONE --"
c "S15 no 2>/dev/null in the shadow block" "$(ext "$P" | grep -q '2>/dev/null' && echo 0 || echo 1)"
c "S16 no '|| true' on an engine line"     "$(ext "$P" | grep -A1 'shadow_execution_engine' | grep -q '|| true' && echo 0 || echo 1)"
c "S16-CONTROL the BASELINE has BOTH"      "$(ext "$B" | grep -q '2>/dev/null' && ext "$B" | grep -q '|| true' && echo 1 || echo 0)"

echo "-- SCOPE --"
# M2E-017C R3 portability: the scope diff is COMPUTED from the canonical
# baseline fixture and the canonical candidate launcher, not read from a
# bundle file. Same baseline->candidate semantics, no sixth committed path.
D="$(mktemp)"; trap 'rm -f "$D"' EXIT; diff -u "$B" "$P" > "$D" || true
c "S17 no OTHER component's launch changed" \
  "$(grep -E '^[-+]' "$D" | grep -vE '^[-+][-+]' | grep -qE 'FETCHER_PID|ACTIVATOR_PID|VOLATILITY_PID|HEAT_PID|MONITOR_PID|WATCHDOG_PID|NOTIF_PID' && echo 0 || echo 1)"
c "S18 SHADOW_PID recording unchanged" \
  "$(grep -E '^[-+]' "$D" | grep -vE '^[-+][-+]' | grep -q 'SHADOW_PID' && echo 0 || echo 1)"
c "S19 log destination unchanged" \
  "$(ext "$P" | grep -q '>> "\$LOG_DIR/shadow_engine.log" 2>&1 &' && echo 1 || echo 0)"
echo; echo "passed $pass  failed $fail"; [ $fail -eq 0 ] || exit 1
