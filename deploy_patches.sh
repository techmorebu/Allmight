#!/usr/bin/env bash
# deploy_patches.sh
#
# Patches AllMight in-place. No repo structure changes.
# Backs up originals to logs/backups/<timestamp>/ before overwriting.
#
# What changes:
#   watchdog.py        -- heartbeat every 30min (was 60), hourly report at 60min
#   discord_alerts.py  -- heartbeat->TERMINAL, hourly_report->DETAILED, fixes bpsbps bug
#   start_allmight.sh  -- kills orphan metrics daemons, adds metrics as proc #4, fixes stop mode bug
#   spread_monitor.py  -- adds --no-fetch flag (stops double-fetching)
#
# Usage:
#   bash deploy_patches.sh          # dry run
#   bash deploy_patches.sh --apply  # deploy for real

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$REPO/logs/backups/$(date -u +%Y%m%d_%H%M%S)"
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

echo ""
echo "AllMight Patch Deployer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Repo: $REPO"
echo " Mode: $( $APPLY && echo 'APPLY' || echo 'DRY RUN (pass --apply to deploy)' )"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

patch_file() {
    local label="$1" target="$2" tmpfile="$3"
    if [[ ! -f "$target" ]]; then
        echo "  SKIP  $label -- not found: $target"
        rm -f "$tmpfile"; return
    fi
    if diff -q "$target" "$tmpfile" > /dev/null 2>&1; then
        echo "  SAME  $label -- already up to date"
        rm -f "$tmpfile"; return
    fi
    echo "  PATCH $label"
    if $APPLY; then
        mkdir -p "$BACKUP_DIR"
        cp "$target" "$BACKUP_DIR/$(basename "$target").bak"
        cp "$tmpfile" "$target"
        echo "        applied (backup saved to $BACKUP_DIR)"
    else
        echo "        (dry run)"
    fi
    rm -f "$tmpfile"
}


# ── 1. spread_monitor.py: inject --no-fetch flag ──────────────────────────────
echo "[ 1/4 ] scripts/spread_monitor.py"
TMP=$(mktemp)
python3 - "$REPO/scripts/spread_monitor.py" "$TMP" << 'PYEOF'
import sys
src = open(sys.argv[1]).read()
if "--no-fetch" in src:
    open(sys.argv[2], "w").write(src); sys.exit(0)

src = src.replace(
    "    args = parser.parse_args()",
    "    parser.add_argument('--no-fetch', action='store_true', dest='no_fetch',\n"
    "                        help='Skip internal master-fetcher calls when managed by start_allmight.sh')\n"
    "    args = parser.parse_args()"
)
src = src.replace(
    "    # Run master fetcher first to ensure fresh data\n"
    "    import subprocess\n"
    "    print(\"\\nFetching fresh data...\")\n"
    "    subprocess.run(\n"
    "        [\"node\", \"scripts/master-fetcher.js\", \"once\"],\n"
    "        cwd=os.path.expanduser(\"~/Allmight\"),\n"
    "        capture_output=True\n"
    "    )",
    "    import subprocess\n"
    "    if not args.no_fetch:\n"
    "        print(\"\\nFetching fresh data...\")\n"
    "        subprocess.run(\n"
    "            [\"node\", \"scripts/master-fetcher.js\", \"once\"],\n"
    "            cwd=os.path.expanduser(\"~/Allmight\"),\n"
    "            capture_output=True\n"
    "        )"
)
src = src.replace(
    "            # Refresh data\n"
    "            subprocess.run(\n"
    "                [\"node\", \"scripts/master-fetcher.js\", \"once\"],\n"
    "                cwd=os.path.expanduser(\"~/Allmight\"),\n"
    "                capture_output=True\n"
    "            )",
    "            if not args.no_fetch:\n"
    "                subprocess.run(\n"
    "                    [\"node\", \"scripts/master-fetcher.js\", \"once\"],\n"
    "                    cwd=os.path.expanduser(\"~/Allmight\"),\n"
    "                    capture_output=True\n"
    "                )"
)
open(sys.argv[2], "w").write(src)
PYEOF
patch_file "spread_monitor.py" "$REPO/scripts/spread_monitor.py" "$TMP"


# ── 2. watchdog.py: 30min heartbeat, 60min hourly report ─────────────────────
echo ""
echo "[ 2/4 ] scripts/watchdog.py"
TMP=$(mktemp)
python3 - "$REPO/scripts/watchdog.py" "$TMP" << 'PYEOF'
import sys, re
src = open(sys.argv[1]).read()

# Fix tick constants
src = re.sub(r'HEARTBEAT_EVERY\s*=\s*\d+.*', 'HEARTBEAT_EVERY = 6     # ticks -> 30 minutes', src)
src = re.sub(r'HOURLY_EVERY\s*=\s*\d+.*',    'HOURLY_EVERY    = 12    # ticks -> 60 minutes', src)

# Add gas + opportunity helpers if not present
if "get_gas_snapshot" not in src:
    helpers = '''
def get_gas_snapshot():
    """Read gas data from Redis (written by gasPriceOracle fetcher)."""
    try:
        raw = _r.get("fetcher:gasPriceOracle")
        if not raw: return None
        blob      = json.loads(raw)
        consensus = blob.get("data", {}).get("consensus", {})
        return {
            "standard": consensus.get("standard", 0),
            "fast":     consensus.get("fast", 0),
            "instant":  consensus.get("instant", 0),
            "network":  blob.get("data", {}).get("networkState", {}).get("label", "UNKNOWN"),
        }
    except: return None


def get_top_opportunities(n=3):
    """Top N opportunities from shadow_trades CSV in the last hour."""
    import csv
    from datetime import timedelta
    csv_path = ROOT / "logs/shadow_trades.csv"
    if not csv_path.exists(): return []
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
        recent = []
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                try:
                    ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                    if ts > cutoff:
                        recent.append(row)
                except: continue
        recent.sort(key=lambda r: float(r.get("gross_edge_bps", 0)), reverse=True)
        return recent[:n]
    except: return []

'''
    # Insert before def restart_process
    src = src.replace("def restart_process(", helpers + "def restart_process(")

# Add metrics to supervised processes list
src = src.replace(
    'for name in ("fetcher","monitor","shadow"):',
    'for name in ("fetcher", "monitor", "shadow", "metrics"):'
)

# Add metrics to restart_process cmds dict if missing
if '"metrics"' not in src:
    src = src.replace(
        '"shadow":  ["python3"',
        '"metrics": ["python3", f"{ROOT}/utils/metrics_engine.py", "--daemon"],\n        "shadow":  ["python3"'
    )
    # Also update monitor restart cmd to include --no-fetch
    src = src.replace(
        '"monitor": ["python3", f"{ROOT}/scripts/spread_monitor.py",\n                    "--chain","all","--interval","60"]',
        '"monitor": ["python3", f"{ROOT}/scripts/spread_monitor.py",\n                    "--chain","all","--interval","60","--no-fetch"]'
    )

# Replace hourly heartbeat block with split heartbeat(30) + hourly_report(60)
old_heartbeat = '        # Hourly heartbeat\n        if check_count % HEARTBEAT_EVERY == 0:\n            discord.heartbeat()'
new_schedule  = (
    '        # 30-min heartbeat -> TERMINAL\n'
    '        if check_count % HEARTBEAT_EVERY == 0:\n'
    '            discord.heartbeat()\n'
    '\n'
    '        # 60-min detailed report -> DETAILED\n'
    '        if check_count % HOURLY_EVERY == 0:\n'
    '            discord.hourly_report(\n'
    '                gas=get_gas_snapshot(),\n'
    '                top_opportunities=get_top_opportunities(n=3)\n'
    '            )'
)
if old_heartbeat in src:
    src = src.replace(old_heartbeat, new_schedule)
elif "HOURLY_EVERY" not in src:
    # fallback: append after heartbeat block if pattern differs
    src = src.replace(
        'if check_count % HEARTBEAT_EVERY == 0:\n            discord.heartbeat()',
        'if check_count % HEARTBEAT_EVERY == 0:\n            discord.heartbeat()\n\n        if check_count % HOURLY_EVERY == 0:\n            discord.hourly_report(gas=get_gas_snapshot(), top_opportunities=get_top_opportunities(n=3))'
    )

open(sys.argv[2], "w").write(src)
PYEOF
patch_file "watchdog.py" "$REPO/scripts/watchdog.py" "$TMP"


# ── 3. discord_alerts.py: add hourly_report(), fix bpsbps, keep routing ──────
echo ""
echo "[ 3/4 ] utils/discord_alerts.py"
TMP=$(mktemp)
python3 - "$REPO/utils/discord_alerts.py" "$TMP" << 'PYEOF'
import sys, re
src = open(sys.argv[1]).read()

# -- Fix bpsbps double suffix in live_revert and execute_alert ----------------
# Strategy: add a _bps() helper and use it in both methods

if "def _bps(" not in src:
    src = src.replace(
        "def _heatmap_bar(heatmap):",
        'def _bps(val):\n    """Ensure exactly one bps suffix."""\n    s = str(val)\n    return s if s.endswith("bps") else f"{s}bps"\n\n\ndef _heatmap_bar(heatmap):'
    )

# Fix live_revert  -- replace f" Edge:     {gross_bps}bps\n"
src = re.sub(
    r'(f" Edge:\s+\{gross_bps\})bps',
    r'\1" + ("" if str(gross_bps).endswith("bps") else "bps") + "',
    src
)
# Cleaner: replace the whole line with _bps()
src = src.replace(
    'f" Edge:     {gross_bps}bps\\n"',
    'f" Edge:     {_bps(gross_bps)}\\n"'
)
src = src.replace(
    'f" Gross edge: {gross_bps}bps\\n"',
    'f" Gross edge: {_bps(gross_bps)}\\n"'
)
# execute_alert gross edge line
src = src.replace(
    'f" Gross edge: {gross_bps}\\n"',
    'f" Gross edge: {_bps(gross_bps)}\\n"'
)

# -- Add hourly_report() method if missing ------------------------------------
if "def hourly_report(" not in src:
    hourly = '''
    def hourly_report(self, gas=None, top_opportunities=None):
        """60-min detailed report. Routes to DETAILED channel."""
        m    = _m()
        sess = m.get("session", {})
        roll = m.get("rolling_24hr", {})
        sys_ = m.get("system", {})
        mvi  = "PASS \\u2705" if sys_.get("mvi_pass") else "FAIL \\u274c"

        trade_lines = (
            f"{\'\\u2500\'*40}\\n"
            f" TRADE SUMMARY\\n"
            f"{\'\\u2500\'*40}\\n"
            f" Session ({m.get(\'session_hours\',0):.1f}hrs)\\n"
            f"  Executed: {sess.get(\'executed\',0):>5}  Skipped: {sess.get(\'skipped\',0):>4}\\n"
            f"  Hit rate: {sess.get(\'hit_rate\',0):>5.1f}%  Win rate:{sess.get(\'win_rate\',0):>5.1f}%\\n"
            f"  P&L/hr:   ${sess.get(\'pnl_per_hr\',0):>8.4f}  [session]\\n"
            f"  P&L:      ${sess.get(\'total_pnl\',0):>8.4f}  [ACTUAL]\\n"
            f" Rolling 24hr\\n"
            f"  Executed: {roll.get(\'executed\',0):>5}  Hit: {roll.get(\'hit_rate\',0):.1f}%\\n"
            f"  P&L:      ${roll.get(\'total_pnl\',0):>8.4f}  [ACTUAL]\\n"
            f" All-Time Live\\n"
            f"  Executed: {m.get(\'live_alltime\',{{}}).get(\'executed\',0):>5}  "
            f"Win: {m.get(\'live_alltime\',{{}}).get(\'win_rate\',0):.1f}%\\n"
            f"  P&L:      ${m.get(\'live_alltime\',{{}}).get(\'total_pnl\',0):>8.4f}  [ON-CHAIN]\\n"
        )

        if gas:
            gas_lines = (
                f"{\'\\u2500\'*40}\\n"
                f" GAS SNAPSHOT (Arbitrum)\\n"
                f"{\'\\u2500\'*40}\\n"
                f"  Standard: {gas.get(\'standard\',0):.2f} gwei\\n"
                f"  Fast:     {gas.get(\'fast\',0):.2f} gwei\\n"
                f"  Instant:  {gas.get(\'instant\',0):.2f} gwei\\n"
                f"  Network:  {gas.get(\'network\',\'UNKNOWN\')}\\n"
            )
        else:
            gas_lines = f"{\'\\u2500\'*40}\\n GAS SNAPSHOT -- no data\\n{\'\\u2500\'*40}\\n"

        if top_opportunities:
            opp_lines = f"{\'\\u2500\'*40}\\n TOP OPPORTUNITIES (last 1hr)\\n{\'\\u2500\'*40}\\n"
            for i, opp in enumerate(top_opportunities[:3], 1):
                opp_lines += (
                    f"  {i}. {opp.get(\'pair\',\'?\')}"
                    f" [{opp.get(\'chain\',\'?\').upper()}]\\n"
                    f"     {opp.get(\'buy_venue\',\'?\')} -> {opp.get(\'sell_venue\',\'?\')}\\n"
                    f"     Gross: {float(opp.get(\'gross_edge_bps\',0)):+.2f}bps"
                    f"  Net: {float(opp.get(\'net_edge_bps\',0)):+.2f}bps\\n"
                    f"     P&L: ${float(opp.get(\'net_profit_usd\',0)):.4f}"
                    f"  [{opp.get(\'decision\',\'?\')}]\\n"
                )
        else:
            opp_lines = (
                f"{\'\\u2500\'*40}\\n"
                f" TOP OPPORTUNITIES -- none in last hour\\n"
                f"{\'\\u2500\'*40}\\n"
            )

        text = (
            f"\\U0001f4c8 **Hourly Report** | {_ts()}\\n"
            f"```\\n"
            f" MVI Gate: {mvi}\\n\\n"
            f"{trade_lines}\\n"
            f"{gas_lines}\\n"
            f"{opp_lines}"
            f"{\'\\u2500\'*40}\\n"
            f"```"
        )
        if len(text) > 1900:
            mid   = text.find("\\u2500"*40, len(text)//2)
            part1 = (text[:mid].rstrip() + "\\n```") if mid > 0 else text[:1900] + "\\n```"
            part2 = ("```\\n" + text[mid:]) if mid > 0 else "```\\n" + text[1900:]
            return _send(DETAILED_WEBHOOK, part1) and _send(DETAILED_WEBHOOK, part2)
        return _send(DETAILED_WEBHOOK, text)

'''
    # Insert before def shadow_report
    src = src.replace("    def shadow_report(", hourly + "    def shadow_report(")

# -- Update heartbeat routing comment (already goes to TERMINAL, just clarify) -
src = src.replace(
    'def heartbeat(self, message=""):',
    'def heartbeat(self, message=""):  # 30-min pulse -> TERMINAL'
)

open(sys.argv[2], "w").write(src)
PYEOF
patch_file "discord_alerts.py" "$REPO/utils/discord_alerts.py" "$TMP"


# ── 4. start_allmight.sh: orphan kill, metrics proc, stop mode fix ────────────
echo ""
echo "[ 4/4 ] scripts/start_allmight.sh"
TMP=$(mktemp)
python3 - "$REPO/scripts/start_allmight.sh" "$TMP" << 'PYEOF'
import sys, re
src = open(sys.argv[1]).read()

# Fix stop mode indentation bug:
# discord.shutdown call must be INSIDE the if --stop block (indented)
src = src.replace(
    '    rm -f "$PID_FILE"\n    echo "Done."\npython3 -c "',
    '    rm -f "$PID_FILE"\n    echo "Done."\n    python3 -c "'
)
# Make sure exit 0 comes after the python3 block not before
# (structure: Done -> python3 -> exit 0)

# Add orphan metrics_engine kill after PID file guard if not already present
if "orphan" not in src.lower() and "pkill -f" not in src:
    src = src.replace(
        '# ── Load env',
        '# ── Kill orphan metrics_engine daemons ───────────────────────────────────────\n'
        'ORPHANS=$(pgrep -fc "metrics_engine.py --daemon" 2>/dev/null || true)\n'
        'if [[ "$ORPHANS" -gt 0 ]]; then\n'
        '    echo "Killing $ORPHANS orphan metrics_engine daemon(s)..."\n'
        '    pkill -f "metrics_engine.py --daemon" 2>/dev/null || true\n'
        '    sleep 1\n'
        'fi\n\n'
        '# ── Load env'
    )

# Add metrics engine launch after shadow if not already present
if "metrics_engine.py --daemon" not in src:
    src = src.replace(
        '# ── 4. Watchdog',
        '# ── 4. Metrics engine daemon ─────────────────────────────────────────────────\n'
        'python3 "$REPO/utils/metrics_engine.py" --daemon \\\n'
        '    >> "$LOG_DIR/metrics.log" 2>&1 &\n'
        'METRICS_PID=$!\n'
        'echo "metrics=$METRICS_PID" >> "$PID_FILE"\n'
        'echo "Metrics engine started (PID $METRICS_PID) -- logs/metrics.log"\n\n'
        '# ── 5. Watchdog'
    )
    # Renumber watchdog section comment
    src = src.replace('# ── 4. Watchdog', '# ── 5. Watchdog')

# Add --no-fetch to spread_monitor launch
src = src.replace(
    'python3 "$REPO/scripts/spread_monitor.py" \\\n'
    '    --chain all \\\n'
    '    --interval "$INTERVAL" \\\n'
    '    >> "$LOG_DIR/monitor.log"',
    'python3 "$REPO/scripts/spread_monitor.py" \\\n'
    '    --chain all \\\n'
    '    --interval "$INTERVAL" \\\n'
    '    --no-fetch \\\n'
    '    >> "$LOG_DIR/monitor.log"'
)

open(sys.argv[2], "w").write(src)
PYEOF
patch_file "start_allmight.sh" "$REPO/scripts/start_allmight.sh" "$TMP"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if $APPLY; then
    echo " Deploy complete."
    echo " Backups: $BACKUP_DIR"
    echo ""
    echo " Restart sequence:"
    echo "   bash scripts/start_allmight.sh --stop"
    echo "   pkill -f 'metrics_engine.py --daemon' 2>/dev/null || true"
    echo "   bash scripts/start_allmight.sh --live"
else
    echo " Dry run complete. Nothing changed."
    echo " To deploy: bash deploy_patches.sh --apply"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
