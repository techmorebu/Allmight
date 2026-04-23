# ALLMIGHT — REMOTE SESSION CHEAT SHEET

---

## CORE PRINCIPLE

```
Home machine  =  source of truth  (runs the stack)
Remote device =  control surface  (SSH in, run commands)
```

---

## CONNECT FROM ANYWHERE

```bash
# 1. Open Tailscale on your device
# 2. SSH in
ssh allmight@<tailscale-ip>

# 3. You're in — all commands work from here
```

---

## CANONICAL STARTUP (every session)

```bash
redis-cli ping          # must return PONG

cd ~/Allmight
git pull

remote_ctl start        # Redis check + pull + launch + wait + status
```

**Or manually:**

```bash
redis-cli ping
cd ~/Allmight && git pull
nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
disown
sleep 15
bash scripts/tools/start_all.sh status
node scripts/tools/session_policy_check.js
```

Expected after startup:
- 6 processes show RUNNING (fetcher, monitor, heat, activator, watchdog, notifier)
- Policy shows STANDARD
- Discord shows `🟢 ALLMIGHT STARTED`
- First heartbeat in Discord within 5 min

---

## CANONICAL STOP

```bash
remote_ctl stop
```

What happens automatically:
- All 6 processes killed cleanly
- Full analysis pipeline runs (9 steps)
- Session zipped to `logs/archive/session_YYYYMMDD_HHMM.zip`
- Discord stop summary fires
- Confidence log runs and prints verdict

---

## ONE-COMMAND CONTROL

```bash
remote_ctl status       # process health + policy mode
remote_ctl start        # full launch sequence
remote_ctl stop         # graceful stop + analysis + zip
remote_ctl abort        # emergency kill — session discarded
remote_ctl restart      # stop then start clean
remote_ctl policy       # current mode only
remote_ctl rpc          # RPC endpoint health check
remote_ctl logs         # tail live launch log (Ctrl+C to exit)
remote_ctl confidence   # dry-run confidence log
remote_ctl discord      # fire test alerts to Discord
```

---

## DAILY FLOW FROM PHONE

```bash
remote_ctl status       # are all 6 running?
remote_ctl policy       # what mode are we in?
remote_ctl logs         # anything look wrong?
```

Discord passive:
- Heartbeat every 5 min → ops channel
- Any alert → act immediately

---

## OPERATING MODES

| Mode | Max size | Action |
|------|---------|--------|
| STANDARD | $500 | Normal — continue |
| CONSERVATIVE | $300 | Degraded infra — watch |
| AGGRESSIVE | $1000 | Manual only — be careful |
| PAUSE | — | Stop immediately |

---

## WHEN TO ACT

**Restart if:**
```bash
remote_ctl restart
```
- Activator silent alert in Discord
- Status shows process NOT RUNNING
- Logs stopped updating

**Abort (emergency only):**
```bash
remote_ctl abort
```
- Something is badly wrong
- Need to make a quick edit and restart clean
- Session started in wrong state

**After abort — edit then restart:**
```bash
git pull          # or make your edits
remote_ctl start
```

---

## WHAT TO WATCH IN DISCORD

**OPS channel (every 5 min heartbeat):**
```
📡 SESSION STATUS
Runtime | Signals | Confirmed | Capture
Est. Value | Value/hr | Mode | Infra
```

**Act on:**
- `💀 ACTIVATOR SILENT` → restart
- `🚨 SYSTEM FAILED` → stop and investigate
- `⬇️ MODE CHANGE` → check policy
- `🔥 HIGH-VALUE BURST` → surface is hot

**Ignore:**
- Every raw signal
- Every blueprint
- Every RPC retry

---

## CONFIDENCE LOG

```bash
remote_ctl confidence
```

| Result | Meaning |
|--------|---------|
| FULLY_VALID (9/9) | Perfect session |
| VALID (8/9) | C9 not marked — fill template |
| PARTIAL (6-7/9) | Check failure reasons |
| INVALID | Do not submit to Boss |

After stop, mark C9:
```bash
node scripts/tools/dryrun_confidence_log.js \
  --mark-c9 logs/sessions/session_YYYYMMDD_HHMM
```

---

## LOG LOCATIONS

```
logs/sessions/session_YYYYMMDD_HHMM/   ← raw files (temp)
logs/archive/session_YYYYMMDD_HHMM.zip ← compressed (permanent)
logs/aborted/session_YYYYMMDD_HHMM/    ← aborted sessions
logs/launch.log                         ← startup output
logs/allmight.pid                       ← running PIDs
logs/allmight.session                   ← current session ID
```

---

## DEVICE GUIDE

| Device | Use for |
|--------|---------|
| **Phone** | status, restart, Discord alerts, emergency abort |
| **Tablet** | status, light edits, log review, git commits |
| **Laptop** | full coding, debugging, multi-file edits, VS Code Remote SSH |

**Phone apps:** Termius + Tailscale + Discord  
**Laptop:** VS Code + Remote SSH extension + Tailscale

---

## DO NOT

```
❌ Run stack from two machines simultaneously
❌ Edit files without git pull first
❌ Ignore PAUSE mode
❌ Bypass remote_ctl for core actions
❌ Commit secrets (.env) to git
```

---

## SETUP (one-time on home machine)

```bash
# SSH server
sudo apt install -y openssh-server
sudo systemctl enable ssh && sudo systemctl start ssh

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# remote_ctl shortcut
chmod +x ~/Allmight/scripts/tools/remote_ctl.sh
mkdir -p ~/.local/bin
ln -sf ~/Allmight/scripts/tools/remote_ctl.sh ~/.local/bin/remote_ctl
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Test
remote_ctl help
```

---

*AllMight Remote Session Cheat Sheet — v1.0*
