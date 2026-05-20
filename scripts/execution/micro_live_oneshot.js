#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — One-Shot Micro-Live Executor
// ────────────────────────────────────────────────────────────────────────────
//  PLACEMENT: scripts/execution/micro_live_oneshot.js
//
//  AUTHORITY: Boss ruling 2026-05-05 — CONDITIONAL YES on Phase 3 micro-live
//  MODEL:     one signal → one trade → stop. NO loop, NO repeat, NO scaling.
//
//  BEHAVIOR
//  ────────
//  1. Watch session activator.jsonl for the next EXECUTION_READY signal that
//     passes ALL Boss-mandated gates.
//  2. Run TWO callStatic passes against the deployed AllMightRamsesExecutor:
//        pass 1: minProfit=1   → mechanical viability
//        pass 2: minProfit=ceil(gas × 1.5) → profitability with safety margin
//  3. If both pass and not --dry, broadcast ONE transaction.
//  4. Wait for receipt. Log everything. Discord-notify.
//  5. ATOMIC: flip AUTO_MICRO_ONESHOT=false in .env (and optionally
//     LIVE_DEPLOY_APPROVED=false with --lock-after-trade).
//  6. Exit 0. Do not re-arm. Do not retry.
//
//  FAIL-CLOSED CONTRACT
//  ────────────────────
//  Any uncertainty (RPC error, missing artifact, ambiguous signal, gate
//  failure on a candidate) → log reason, do NOT trade, keep watching until
//  --max-wait-sec elapses. On timeout, exit 0 without flipping flags.
//
//  HARD GATES (Boss spec)
//  ──────────────────────
//    LIVE_DEPLOY_APPROVED=true   (env)
//    AUTO_MICRO_ONESHOT=true     (env)
//    EXECUTOR_ADDRESS set + bytecode present
//    METAMASK_PRIVATE_KEY set
//    spread × 100 ≥ 24 bps
//    regime ∈ {PRIME, ELITE}     (derived from maxSpread)
//    volatility ≠ FADING         (derived from recent spread sequence)
//    watchdog overallStatus=HEALTHY, fresh ≤ 90s
//    no stale critical processes (activator, monitor, heat)
//    live gas price ≤ 0.05 gwei
//    wallet ETH ≥ 0.001
//    tradesToday == 0
//    dailyLossCap budget remaining (cumulative loss > -$5)
//    callStatic pass 1 → WOULD_EXECUTE
//    callStatic pass 2 → WOULD_EXECUTE (with profit-buffered minProfit)
//    expectedNetUsd > 0 (by construction of pass 2)
//
//  USAGE
//  ─────
//    node scripts/execution/micro_live_oneshot.js --help
//    node scripts/execution/micro_live_oneshot.js --dry
//    node scripts/execution/micro_live_oneshot.js --max-wait-sec 3600
//    node scripts/execution/micro_live_oneshot.js --lock-after-trade
//
//  OUTPUT
//  ──────
//    logs/sessions/<session>/micro_live_trade.json   (final outcome)
//    logs/sessions/<session>/micro_live_trade.jsonl  (append-only events)
//
//  ACCEPTANCE
//  ──────────
//    node --check scripts/execution/micro_live_oneshot.js
//
//  This script does NOT modify any contract, does NOT change any threshold,
//  does NOT enable any other surface. It is a guarded one-shot.
// ════════════════════════════════════════════════════════════════════════════

// ─── ARGS (parsed BEFORE any heavy require so --help works in any env) ───────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_HELP             = ARGS.includes('--help');
const FLAG_DRY              = ARGS.includes('--dry');
const FLAG_LOCK_AFTER_TRADE = ARGS.includes('--lock-after-trade');
const MAX_WAIT_SEC          = Math.max(60, parseInt(argVal('--max-wait-sec', '3600'), 10) || 3600);
const POLL_INTERVAL_MS      = Math.max(1000, parseInt(argVal('--poll-ms', '5000'), 10) || 5000);
// --min-spread-bps N: raise the spread floor for this run only.
// RAISE-ONLY: any value below the Boss-locked MIN_SPREAD_BPS is ignored.
const MIN_SPREAD_BPS_OVERRIDE = parseInt(argVal('--min-spread-bps', '0'), 10) || 0;
const SIGNAL_FRESHNESS_SEC  = 60;   // signal must be ≤60s old
const WATCHDOG_FRESHNESS_SEC= 90;   // watchdog record must be ≤90s old

if (FLAG_HELP) {
  // Inline help — no requires, no I/O, exits 0 for any environment.
  console.log(`
AllMight — Micro-Live One-Shot Executor (Boss-approved 2026-05-05)

USAGE
  node scripts/execution/micro_live_oneshot.js [flags]

FLAGS
  --help                 Show this and exit 0.
  --dry                  Run all gates + callStatic, NO broadcast.
                         Use this for rehearsal.
  --max-wait-sec N       Watch for up to N seconds (default 3600).
  --poll-ms N            Poll interval in ms (default 5000, min 1000).
  --min-spread-bps N     Raise the spread floor for THIS run only.
                         Raise-only: values below the Boss-locked
                         constant (24bps) are ignored.
  --lock-after-trade     Also flip LIVE_DEPLOY_APPROVED=false post-trade
                         (Boss recommends; default off).

REQUIRED ENV
  LIVE_DEPLOY_APPROVED=true     (Boss-only flag)
  AUTO_MICRO_ONESHOT=true       (auto-flips to false post-trade)
  EXECUTOR_ADDRESS=0x...        (deployed AllMightRamsesExecutor)
  METAMASK_PRIVATE_KEY=...      (owner of the executor)
  ARBITRUM_MAINNET_RPC_URL_2 (or _1, or RPC_DESIGNATED_PRIMARY_URL)

OPTIONAL ENV (DRY MODE ONLY)
  REHEARSAL_MIN_SPREAD_BPS=N    Lowers the spread floor for rehearsal
                                purposes only. Honored ONLY when --dry
                                is set. IGNORED in live mode.
                                Boss authorization required.

OUTPUTS
  logs/sessions/<session>/micro_live_trade.json   final outcome
  logs/sessions/<session>/micro_live_trade.jsonl  per-event log

EXIT CODES
  0 — always (fail-closed model). Inspect outputs for status.
`);
  process.exit(0);
}

// dotenv loaded externally via -r dotenv/config OR sourced .env in shell.
// We also load it inline as a belt-and-braces measure.
try { require('dotenv').config(); } catch { /* optional */ }

const fs   = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ─── CONSTANTS (Boss-locked) ──────────────────────────────────────────────────

const USDC                   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const TRADE_SIZE_USDC_MICRO  = BigInt(25e6);   // $25 USDC, 6 decimals — Boss cap
const DIRECTION_RAMSES_FIRST = 0;
const SLIPPAGE_BUFFER        = 0.95;           // 5% off blueprint expected output
const MIN_SPREAD_BPS         = 24;             // Boss hard rule
const MAX_GAS_GWEI           = 0.05;           // Boss spec
const MIN_WALLET_ETH         = 0.001;          // gas reserve
const DAILY_LOSS_CAP_USD     = 5;              // Boss cap
const MAX_TRADES_TODAY       = 1;              // Boss cap
const RECEIPT_TIMEOUT_MS     = 120_000;
const ETH_USD_FALLBACK       = 2300;

const EXECUTOR_ABI = [
  'function executeRamsesArb(address borrowAsset, uint256 amount, uint256 minProfit, uint256 amountOutMinA, uint256 amountOutMinB, uint8 direction, uint256 deadline) external',
  'function USDC() view returns (address)',
  'function owner() view returns (address)',
  'event ArbRequested(address indexed asset, uint256 amount, uint8 direction, uint256 minProfit)',
  'event ArbExecuted(address indexed asset, uint256 amount, uint256 profit, uint8 direction)',
];

const REPO       = process.cwd();
const LOGS_DIR   = path.join(REPO, 'logs');
const SESSIONS   = path.join(LOGS_DIR, 'sessions');
const ENV_PATH   = path.join(REPO, '.env');
const T_START    = Date.now();

// ─── LOGGER ───────────────────────────────────────────────────────────────────

const _events = [];
let _jsonlPath = null;   // set after session resolution

function emit(eventType, payload = {}) {
  const rec = {
    ts: new Date().toISOString(),
    event: eventType,
    ...payload,
  };
  _events.push(rec);
  if (_jsonlPath) {
    try { fs.appendFileSync(_jsonlPath, JSON.stringify(rec) + '\n'); } catch { /* fail-soft */ }
  }
  // Mirror to stdout for live observation
  const tag = eventType.padEnd(28);
  const msg = Object.keys(payload).length > 0
    ? Object.entries(payload).slice(0, 6).map(([k,v]) =>
        typeof v === 'object' ? `${k}=${JSON.stringify(v).slice(0,40)}` : `${k}=${v}`
      ).join(' ')
    : '';
  console.log(`  [${rec.ts}] ${tag} ${msg}`);
}

function fatal(reason, extra = {}) {
  emit('ABORT', { reason, ...extra });
  writeFinalJson({ status: 'ABORTED', reason, ...extra });
  process.exit(0);   // fail-closed exits 0; supervisor will not restart
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(p, fromByte = 0) {
  if (!fs.existsSync(p)) return { records: [], nextByte: 0 };
  const stat = fs.statSync(p);
  if (stat.size < fromByte) return { records: [], nextByte: stat.size };  // truncated
  const fd  = fs.openSync(p, 'r');
  const len = stat.size - fromByte;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, fromByte);
  fs.closeSync(fd);
  const records = buf.toString('utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return { records, nextByte: stat.size };
}

function readJsonlAll(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function tsOf(rec) {
  if (!rec || !rec.ts) return 0;
  const d = new Date(rec.ts).getTime();
  return Number.isFinite(d) ? d : 0;
}

function ageSec(rec) {
  const t = tsOf(rec);
  return t > 0 ? (Date.now() - t) / 1000 : Infinity;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function todayUtcKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

// ─── SESSION RESOLUTION ──────────────────────────────────────────────────────

function resolveSession() {
  const ptr = path.join(LOGS_DIR, 'allmight.session');
  if (!fs.existsSync(ptr)) return null;
  const sid = fs.readFileSync(ptr, 'utf8').trim();
  if (!sid) return null;
  const dir = path.join(SESSIONS, `session_${sid}`);
  return fs.existsSync(dir) ? { sid, dir } : null;
}

// ─── REGIME CLASSIFICATION (mirrors notification_router.js Boss spec) ─────────
// Regime is derived from maxSpread alone for the gate. Boss said do not rely
// on the label — but since the label IS computed from spread, "spread ≥ 24"
// AND "regime ∈ PRIME/ELITE" are equivalent. Both gates are kept for
// belt-and-braces; they cannot disagree.

function classifyRegime(spreadBps) {
  if (spreadBps >= 24) return 'ELITE';
  if (spreadBps >= 22) return 'PRIME';
  if (spreadBps >= 20) return 'ACTIVE';
  if (spreadBps >= 18) return 'BUILDING';
  return 'QUIET';
}

// ─── VOLATILITY DIRECTION (mirrors notification_router.js) ────────────────────
// SURGING / RISING / STABLE / FADING. Boss gate: not FADING.
// Reads the last N EXECUTION_READY-or-marginal records from activator.jsonl.

function classifyVolatility(activatorRecords) {
  // Pull recent spreads from any signal record (EXECUTION_READY,
  // SIMULATION_MARGINAL, SIMULATION_LOST — all carry .spread in pct form).
  const recent = activatorRecords
    .filter(r => typeof r.spread === 'number' && r.spread >= 0)
    .slice(-8)
    .map(r => r.spread * 100);  // pct → bps
  if (recent.length < 4) return { label: 'UNKNOWN', samples: recent.length };

  // recent[0] is OLDEST; we need newest-first to mirror notification_router.
  const newestFirst = recent.slice().reverse();
  const half        = Math.ceil(newestFirst.length / 2);
  const newest      = newestFirst.slice(0, half);
  const older       = newestFirst.slice(half);
  const avgNewest   = newest.reduce((a,b)=>a+b,0) / newest.length;
  const avgOlder    = older.reduce((a,b)=>a+b,0) / older.length;
  const delta       = avgNewest - avgOlder;
  const absJump     = newestFirst[0] - (newestFirst[3] ?? newestFirst[newestFirst.length-1]);

  let label;
  if (absJump >= 3)      label = 'SURGING';
  else if (delta >= 1)   label = 'RISING';
  else if (delta <= -1)  label = 'FADING';
  else                   label = 'STABLE';
  return { label, delta: +delta.toFixed(2), absJump: +absJump.toFixed(2), samples: recent.length };
}

// ─── WATCHDOG STATE READ ──────────────────────────────────────────────────────

function readWatchdogState(sessionDir) {
  const p = path.join(sessionDir, 'watchdog.jsonl');
  const all = readJsonlAll(p);
  if (all.length === 0) return null;
  // Find latest record with overallStatus
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].overallStatus) return all[i];
  }
  return null;
}

// ─── TRADES-TODAY COUNTER ────────────────────────────────────────────────────
// Scans logs/sessions/*/micro_live_trade.json for txHash + today's date.

function countTradesToday() {
  if (!fs.existsSync(SESSIONS)) return { count: 0, lossUsd: 0 };
  let count   = 0;
  let lossUsd = 0;
  const today = todayUtcKey();
  for (const dirent of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const f = path.join(SESSIONS, dirent.name, 'micro_live_trade.json');
    const j = readJson(f);
    if (!j || !j.txHash) continue;
    if ((j.tradedAt || '').slice(0, 10) !== today) continue;
    count++;
    const realized = Number(j.realizedNetUsd ?? 0);
    if (Number.isFinite(realized) && realized < 0) lossUsd += -realized;
  }
  return { count, lossUsd: +lossUsd.toFixed(4) };
}

// ─── ENV FLAG FLIP (atomic, in-place) ────────────────────────────────────────
// Replaces "KEY=anything" with "KEY=value" on its existing line.
// If KEY is not present, appends it. Backup .env → .env.bak.<ts> first.

function flipEnvFlag(key, value) {
  if (!fs.existsSync(ENV_PATH)) {
    emit('ENV_FLIP_SKIPPED', { key, reason: '.env not found' });
    return false;
  }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak.${stamp}`);
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    const re    = new RegExp(`^${key}=.*$`);
    let found = false;
    const out = lines.map(l => {
      if (re.test(l)) { found = true; return `${key}=${value}`; }
      return l;
    });
    if (!found) out.push(`${key}=${value}`);
    const tmp = `${ENV_PATH}.tmp`;
    fs.writeFileSync(tmp, out.join('\n'));
    fs.renameSync(tmp, ENV_PATH);
    // Also mutate the running process env so any later checks reflect new value
    process.env[key] = value;
    emit('ENV_FLIPPED', { key, value });
    return true;
  } catch (e) {
    emit('ENV_FLIP_ERROR', { key, error: e.message });
    return false;
  }
}

// ─── DISCORD NOTIFY (fail-silent, channel-aware) ─────────────────────────────
// Channels:
//   'ops'        — system health, timeouts, fatals, no-candidate states
//   'candidate'  — execution candidates: DRY rehearsal pass, LIVE submit/
//                  receipt/success/revert events. Anything where a
//                  tradeable signal was identified.

async function discordNotify(channel, title, body, status = 'INFO') {
  try {
    const NOTIFIER = path.resolve(REPO, 'scripts/monitoring/discord_notifier');
    const mod = require(NOTIFIER);
    if (channel === 'candidate') {
      // Custom-format embed via sendEmbed, since the structured
      // sendCandidateNotification fields don't fit trade-result events
      // (it expects edge/confidence/profile schema for ready candidates).
      const COLOUR = {
        HEALTHY  : 0x57F287,
        FAILED   : 0xED4245,
        DEGRADED : 0xFEE75C,
        INFO     : 0x5865F2,
      }[status] || 0x5865F2;
      await mod.sendEmbed('candidate', {
        title,
        description: body,
        color: COLOUR,
        timestamp: new Date().toISOString(),
        footer: { text: 'AllMight • micro_live_oneshot' },
      });
    } else {
      await mod.sendOpsNotification({
        title,
        description: body,
        status,
        footer: 'AllMight • micro_live_oneshot',
      });
    }
  } catch (e) {
    emit('DISCORD_NOTIFY_FAILED', { channel, error: (e.message || '').slice(0, 100) });
  }
}

// ─── PROVIDER + WALLET ───────────────────────────────────────────────────────

function buildProvider() {
  const candidates = [
    process.env.RPC_DESIGNATED_PRIMARY_URL,
    process.env.ARBITRUM_MAINNET_RPC_URL_2,
    process.env.ARBITRUM_MAINNET_RPC_URL_1,
  ].filter(u => u && !u.includes('YOUR_'));
  if (candidates.length === 0) return null;
  for (const url of candidates) {
    try { return new ethers.JsonRpcProvider(url); } catch { /* try next */ }
  }
  return null;
}

// ─── BLUEPRINT-DERIVED amountOutMin (scaled to actual trade size) ────────────
// The session blueprint expresses minOuts for the blueprint trade size; we
// scale by (actual / blueprint) and apply slippage buffer.

function computeAmountOutMins(latestSignal, sessionDir) {
  const bpLines  = readJsonlAll(path.join(sessionDir, 'blueprints.jsonl'));
  const bp = bpLines
    .filter(b => String(b.signalBlock ?? '') === String(latestSignal.block ?? ''))
    .pop();

  // Fallback: 95% of theoretical equivalent at signal price, conservative
  if (!bp || !bp.safety || !bp.sizing) {
    // Without blueprint, derive from signal price: $25 / uniPrice = WETH out (minus slippage)
    const wethOut = 25 / Math.max(1, latestSignal.uniPrice ?? 2300);
    return {
      amountOutMinA: BigInt(Math.floor(wethOut * SLIPPAGE_BUFFER * 1e18)),
      amountOutMinB: TRADE_SIZE_USDC_MICRO,    // expect ≥ borrow back
      source: 'fallback_price',
    };
  }

  // Blueprint sizing — scale to our actual borrow
  const bpSizeBase = Number(bp.sizing.baseTokenAmount ?? 0);     // WETH amount in blueprint
  const bpUsdSize  = Number(bp.sizing.usdValue ?? bp.sizing.tradeSizeUsd ?? 0);
  const scale      = bpUsdSize > 0 ? (25 / bpUsdSize) : (TRADE_SIZE_USDC_MICRO === BigInt(25e6) ? 0.125 : 1);

  const minOutA_eth = (Number(bp.safety.minOutEntry ?? bpSizeBase ?? 0)) * scale * SLIPPAGE_BUFFER;
  const minOutB_usd = (Number(bp.safety.minOutExit  ?? bpUsdSize  ?? 0)) * scale * SLIPPAGE_BUFFER;

  return {
    amountOutMinA: BigInt(Math.max(1, Math.floor(minOutA_eth * 1e18))),
    amountOutMinB: BigInt(Math.max(Number(TRADE_SIZE_USDC_MICRO), Math.floor(minOutB_usd * 1e6))),
    source: 'blueprint_scaled',
    blueprintScale: +scale.toFixed(4),
  };
}

// ─── CALLSTATIC PASS ─────────────────────────────────────────────────────────

async function callStaticPass(executor, amountOutMinA, amountOutMinB, minProfitMicro) {
  const deadline = BigInt(Math.floor(Date.now()/1000) + 120);
  try {
    await executor.executeRamsesArb.staticCall(
      USDC, TRADE_SIZE_USDC_MICRO, BigInt(minProfitMicro),
      amountOutMinA, amountOutMinB, DIRECTION_RAMSES_FIRST, deadline
    );
    return { ok: true, deadline };
  } catch (err) {
    const msg = (err.message ?? String(err));
    const reasonMatch = msg.match(/"([A-Z_]{4,40})"/);
    const reason = reasonMatch?.[1]
      ?? (msg.includes('INSUFFICIENT_PROFIT')  ? 'INSUFFICIENT_PROFIT'
        : msg.includes('RAMSES_SLIPPAGE')      ? 'RAMSES_SLIPPAGE'
        : msg.includes('DEADLINE_EXPIRED')     ? 'DEADLINE_EXPIRED'
        : msg.includes('ONLY_USDC')            ? 'ONLY_USDC_SUPPORTED'
        : msg.includes('NOT_OWNER')            ? 'NOT_OWNER'
        : msg.includes('execution reverted')   ? 'EXECUTION_REVERTED'
        : 'UNKNOWN_REVERT');
    return { ok: false, reason, raw: msg.slice(0, 140) };
  }
}

// ─── FINAL JSON WRITER ───────────────────────────────────────────────────────

function writeFinalJson(payload) {
  if (!_jsonlPath) return;
  const finalPath = path.join(path.dirname(_jsonlPath), 'micro_live_trade.json');
  const out = {
    generatedAt: new Date().toISOString(),
    runtimeSec: Math.round((Date.now() - T_START) / 1000),
    flags: {
      dry: FLAG_DRY,
      lockAfterTrade: FLAG_LOCK_AFTER_TRADE,
      maxWaitSec: MAX_WAIT_SEC,
    },
    eventCount: _events.length,
    ...payload,
  };
  try { fs.writeFileSync(finalPath, JSON.stringify(out, null, 2)); }
  catch (e) { /* fail-soft */ }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AllMight — Micro-Live One-Shot Executor');
  console.log(`  Mode:   ${FLAG_DRY ? 'DRY (no broadcast)' : 'LIVE'}`);
  console.log(`  MaxWait: ${MAX_WAIT_SEC}s   Poll: ${POLL_INTERVAL_MS}ms`);
  console.log('═══════════════════════════════════════════════════════════');

  // ── Resolve session ──────────────────────────────────────────────────────
  const session = resolveSession();
  if (!session) {
    console.error('  FATAL: no active session (logs/allmight.session missing or empty).');
    console.error('         Start the stack first: bash scripts/tools/start_all.sh');
    process.exit(0);
  }
  _jsonlPath = path.join(session.dir, 'micro_live_trade.jsonl');
  emit('STARTED', { sessionId: session.sid, sessionDir: session.dir, dry: FLAG_DRY });
  console.log(`  Session: ${session.sid}`);

  // ── Env preflight (FAIL CLOSED) ──────────────────────────────────────────
  if (process.env.LIVE_DEPLOY_APPROVED !== 'true') {
    return fatal('LIVE_DEPLOY_APPROVED!=true', { hint: 'Boss-only flag. CPT must not set this.' });
  }
  if (process.env.AUTO_MICRO_ONESHOT !== 'true') {
    return fatal('AUTO_MICRO_ONESHOT!=true', { hint: 'Set after Boss approval. Auto-flips to false post-trade.' });
  }
  const EXECUTOR_ADDRESS = (process.env.EXECUTOR_ADDRESS ?? '').trim();
  if (!EXECUTOR_ADDRESS || !ethers.isAddress(EXECUTOR_ADDRESS)) {
    return fatal('EXECUTOR_ADDRESS_MISSING_OR_INVALID', { value: EXECUTOR_ADDRESS });
  }
  const PRIV = process.env.METAMASK_PRIVATE_KEY;
  if (!PRIV || PRIV === '****' || PRIV.includes('YOUR_')) {
    return fatal('METAMASK_PRIVATE_KEY_MISSING');
  }

  // ── Provider + executor + wallet ─────────────────────────────────────────
  const provider = buildProvider();
  if (!provider) return fatal('NO_RPC_CONFIGURED');

  let chainId, blockNumber;
  try {
    const net = await provider.getNetwork();
    chainId = Number(net.chainId);
    blockNumber = await provider.getBlockNumber();
  } catch (e) {
    return fatal('RPC_PROBE_FAILED', { error: e.message?.slice(0, 100) });
  }
  if (chainId !== 42161) return fatal('WRONG_CHAIN', { chainId, expected: 42161 });

  let wallet, executorRO, executorRW;
  try {
    wallet      = new ethers.Wallet(PRIV, provider);
    executorRO  = new ethers.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, provider);
    executorRW  = new ethers.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, wallet);
  } catch (e) {
    return fatal('WALLET_OR_CONTRACT_INIT_FAILED', { error: e.message?.slice(0, 100) });
  }

  // Verify executor bytecode + USDC pin
  try {
    const code = await provider.getCode(EXECUTOR_ADDRESS);
    if (code === '0x') return fatal('EXECUTOR_NO_BYTECODE', { addr: EXECUTOR_ADDRESS });
    const usdcPin = await executorRO.USDC();
    if (usdcPin.toLowerCase() !== USDC.toLowerCase()) {
      return fatal('EXECUTOR_WRONG_USDC', { found: usdcPin, expected: USDC });
    }
    const ownerOnChain = await executorRO.owner();
    if (ownerOnChain.toLowerCase() !== wallet.address.toLowerCase()) {
      return fatal('WALLET_NOT_OWNER', { wallet: wallet.address, owner: ownerOnChain });
    }
  } catch (e) {
    return fatal('EXECUTOR_VERIFY_FAILED', { error: e.message?.slice(0, 100) });
  }

  emit('PREFLIGHT_OK', {
    chainId, block: blockNumber, executor: EXECUTOR_ADDRESS, wallet: wallet.address,
  });

  // ── Trades-today + daily-loss preflight ──────────────────────────────────
  const td = countTradesToday();
  if (td.count >= MAX_TRADES_TODAY) {
    return fatal('TRADES_TODAY_CAP_REACHED', { count: td.count, cap: MAX_TRADES_TODAY });
  }
  if (td.lossUsd >= DAILY_LOSS_CAP_USD) {
    return fatal('DAILY_LOSS_CAP_REACHED', { lossUsd: td.lossUsd, cap: DAILY_LOSS_CAP_USD });
  }
  emit('TRADES_TODAY', td);

  // ── Watch loop ───────────────────────────────────────────────────────────
  const activatorPath = path.join(session.dir, 'activator.jsonl');
  let activatorByte   = fs.existsSync(activatorPath) ? fs.statSync(activatorPath).size : 0;
  // We only consider records produced AFTER script start. Capture current
  // tail position so historical records do not retro-trigger.
  emit('WATCH_BEGIN', { activatorPath, tailByte: activatorByte });

  const deadlineMs = T_START + MAX_WAIT_SEC * 1000;
  let recentSpreadBuffer = [];   // last 8 spread observations for volatility calc

  while (Date.now() < deadlineMs) {
    await sleep(POLL_INTERVAL_MS);

    // Read new activator records since last poll
    let newRecs = [];
    try {
      const r = readJsonl(activatorPath, activatorByte);
      newRecs = r.records;
      activatorByte = r.nextByte;
    } catch (e) {
      emit('ACTIVATOR_READ_ERROR', { error: e.message?.slice(0, 80) });
      continue;
    }

    // Update rolling spread buffer
    for (const r of newRecs) {
      if (typeof r.spread === 'number') {
        recentSpreadBuffer.push(r);
        if (recentSpreadBuffer.length > 16) recentSpreadBuffer.shift();
      }
    }

    // Find newest EXECUTION_READY in this batch (if any)
    const candidate = [...newRecs].reverse()
      .find(r => r.signal === 'EXECUTION_READY' && typeof r.spread === 'number');
    if (!candidate) continue;

    const spreadBps = +(candidate.spread * 100).toFixed(2);
    emit('SIGNAL_CANDIDATE', {
      spreadBps, block: candidate.block, signalTs: candidate.ts,
      signalAgeSec: +ageSec(candidate).toFixed(1),
    });

    // ── GATE 1: spread ≥ effective floor ──
    // Floor resolution rules (defense-in-depth):
    //  - LIVE mode (FLAG_DRY=false): floor = max(MIN_SPREAD_BPS, --min-spread-bps).
    //    REHEARSAL_MIN_SPREAD_BPS is IGNORED in live mode. The Boss-locked 24bps
    //    cannot be lowered by any means in live mode.
    //  - DRY mode (FLAG_DRY=true): if Boss-authorized REHEARSAL_MIN_SPREAD_BPS env
    //    var is set to a positive integer, it can LOWER the floor (since dry mode
    //    structurally cannot broadcast). --min-spread-bps still raises further.
    let effectiveMinSpread;
    let floorSource;
    if (FLAG_DRY) {
      const rehearsalOverride = parseInt(process.env.REHEARSAL_MIN_SPREAD_BPS || '0', 10) || 0;
      if (rehearsalOverride > 0) {
        effectiveMinSpread = Math.max(rehearsalOverride, MIN_SPREAD_BPS_OVERRIDE);
        floorSource = `dry_rehearsal_override(${rehearsalOverride}bps)`;
      } else {
        effectiveMinSpread = Math.max(MIN_SPREAD_BPS, MIN_SPREAD_BPS_OVERRIDE);
        floorSource = `boss_default(${MIN_SPREAD_BPS}bps)`;
      }
    } else {
      // LIVE: REHEARSAL_MIN_SPREAD_BPS cannot influence the floor.
      effectiveMinSpread = Math.max(MIN_SPREAD_BPS, MIN_SPREAD_BPS_OVERRIDE);
      floorSource = MIN_SPREAD_BPS_OVERRIDE > MIN_SPREAD_BPS
        ? `cli_raise(${MIN_SPREAD_BPS_OVERRIDE}bps)`
        : `boss_locked(${MIN_SPREAD_BPS}bps)`;
    }
    if (spreadBps < effectiveMinSpread) {
      emit('GATE_FAIL', { gate: 'spread', spreadBps, threshold: effectiveMinSpread,
        floorBoss: MIN_SPREAD_BPS, source: floorSource });
      continue;
    }

    // ── GATE 2: signal freshness ──
    const sigAge = ageSec(candidate);
    if (sigAge > SIGNAL_FRESHNESS_SEC) {
      emit('GATE_FAIL', { gate: 'signal_freshness', ageSec: +sigAge.toFixed(1), max: SIGNAL_FRESHNESS_SEC });
      continue;
    }

    // ── GATE 3: regime PRIME or ELITE ──
    const regime = classifyRegime(spreadBps);
    if (regime !== 'PRIME' && regime !== 'ELITE') {
      emit('GATE_FAIL', { gate: 'regime', regime, spreadBps });
      continue;
    }

    // ── GATE 4: volatility not FADING ──
    const vol = classifyVolatility(recentSpreadBuffer);
    if (vol.label === 'FADING') {
      emit('GATE_FAIL', { gate: 'volatility', vol });
      continue;
    }

    // ── GATE 5: watchdog HEALTHY + fresh ──
    const wd = readWatchdogState(session.dir);
    if (!wd) {
      emit('GATE_FAIL', { gate: 'watchdog_missing' });
      continue;
    }
    const wdAge = ageSec(wd);
    if (wdAge > WATCHDOG_FRESHNESS_SEC) {
      emit('GATE_FAIL', { gate: 'watchdog_stale', ageSec: +wdAge.toFixed(1) });
      continue;
    }
    if (wd.overallStatus !== 'HEALTHY') {
      emit('GATE_FAIL', { gate: 'watchdog_status', status: wd.overallStatus });
      continue;
    }

    // ── GATE 6: no stale critical processes ──
    const stale = Array.isArray(wd.staleComponents) ? wd.staleComponents : [];
    const criticalStale = stale.filter(c => ['activator', 'monitor', 'heat'].includes(String(c).toLowerCase()));
    if (criticalStale.length > 0) {
      emit('GATE_FAIL', { gate: 'critical_stale', components: criticalStale });
      continue;
    }

    // ── GATE 7: live gas price ≤ MAX_GAS_GWEI ──
    let gasPriceWei, gasPriceGwei;
    try {
      const fee = await provider.getFeeData();
      gasPriceWei  = fee.gasPrice ?? 0n;
      gasPriceGwei = Number(gasPriceWei) / 1e9;
    } catch (e) {
      emit('GATE_FAIL', { gate: 'gas_probe_error', error: e.message?.slice(0,80) });
      continue;
    }
    if (gasPriceGwei > MAX_GAS_GWEI) {
      emit('GATE_FAIL', { gate: 'gas_too_high', gwei: +gasPriceGwei.toFixed(4), max: MAX_GAS_GWEI });
      continue;
    }

    // ── GATE 8: wallet ETH ≥ MIN_WALLET_ETH ──
    let walletEth;
    try {
      const bal = await provider.getBalance(wallet.address);
      walletEth = Number(ethers.formatEther(bal));
    } catch (e) {
      emit('GATE_FAIL', { gate: 'balance_probe_error', error: e.message?.slice(0,80) });
      continue;
    }
    if (walletEth < MIN_WALLET_ETH) {
      emit('GATE_FAIL', { gate: 'low_wallet_eth', walletEth: +walletEth.toFixed(6), min: MIN_WALLET_ETH });
      continue;
    }

    // ── Compute amountOutMin from blueprint (scaled to $25) ──
    const mins = computeAmountOutMins(candidate, session.dir);
    emit('AMOUNT_OUT_MINS', {
      source: mins.source,
      blueprintScale: mins.blueprintScale ?? null,
      minOutA: mins.amountOutMinA.toString(),
      minOutB: mins.amountOutMinB.toString(),
    });

    // ── CALLSTATIC PASS 1: mechanical viability (minProfit=1) ──
    const pass1 = await callStaticPass(executorRW, mins.amountOutMinA, mins.amountOutMinB, 1n);
    if (!pass1.ok) {
      emit('GATE_FAIL', { gate: 'callStatic_pass1', reason: pass1.reason });
      continue;
    }

    // ── Estimate gas (best-effort) ──
    let gasEstimate, gasCostUsd;
    try {
      const gas = await executorRW.executeRamsesArb.estimateGas(
        USDC, TRADE_SIZE_USDC_MICRO, 1n,
        mins.amountOutMinA, mins.amountOutMinB, DIRECTION_RAMSES_FIRST, pass1.deadline
      );
      gasEstimate = Number(gas);
      gasCostUsd  = (gasEstimate * Number(gasPriceWei) / 1e18) * ETH_USD_FALLBACK;
    } catch (e) {
      emit('GATE_FAIL', { gate: 'gas_estimate', error: e.message?.slice(0,80) });
      continue;
    }
    emit('GAS_ESTIMATE', { units: gasEstimate, gwei: +gasPriceGwei.toFixed(4), costUsd: +gasCostUsd.toFixed(4) });

    // ── CALLSTATIC PASS 2: profitability (minProfit = ceil(gas × 1.5)) ──
    // minProfit is in micro-USDC (USDC has 6 decimals). gasCostUsd in USD.
    const minProfitUsd   = gasCostUsd * 1.5;
    const minProfitMicro = BigInt(Math.max(1, Math.ceil(minProfitUsd * 1e6)));
    const pass2 = await callStaticPass(executorRW, mins.amountOutMinA, mins.amountOutMinB, minProfitMicro);
    if (!pass2.ok) {
      emit('GATE_FAIL', { gate: 'callStatic_pass2_unprofitable',
        reason: pass2.reason, minProfitUsd: +minProfitUsd.toFixed(4) });
      continue;
    }

    const expectedNetUsd = +(minProfitUsd - gasCostUsd).toFixed(4);
    emit('GATES_PASSED', {
      spreadBps, regime, volatility: vol.label,
      effectiveMinSpread, floorSource,
      gasUsd: +gasCostUsd.toFixed(4),
      minProfitUsd: +minProfitUsd.toFixed(4),
      expectedNetUsd,
      walletEth: +walletEth.toFixed(6),
      block: candidate.block,
    });

    // ── DRY MODE: stop here, no broadcast ──
    if (FLAG_DRY) {
      emit('DRY_MODE_NO_BROADCAST', { reason: '--dry flag set' });
      // Document the post-trade lock-flip plan WITHOUT actually flipping
      // anything. Proves wiring without side effects.
      emit('DRY_MODE_LOCK_PLAN', {
        wouldFlipAutoMicroOneshot: 'true → false',
        wouldFlipLiveDeployApproved: FLAG_LOCK_AFTER_TRADE
          ? 'true → false (--lock-after-trade set)'
          : 'unchanged (--lock-after-trade NOT set)',
        wouldNotifyDiscord: true,
        note: 'In LIVE mode these flips happen post-receipt, before exit.',
      });
      writeFinalJson({
        status: 'DRY_PASS',
        spreadBps, regime, volatility: vol.label,
        expectedNetUsd, gasCostUsd: +gasCostUsd.toFixed(4),
        gasUnits: gasEstimate,
        signalBlock: candidate.block,
        effectiveMinSpreadBps: effectiveMinSpread,
        lockAfterTradeWouldApply: FLAG_LOCK_AFTER_TRADE,
      });
      await discordNotify(
        'candidate',
        '🧪 AllMight micro-live DRY rehearsal — candidate identified',
        `All gates passed.\nSpread: ${spreadBps}bps (floor ${effectiveMinSpread}, source ${floorSource})  Regime: ${regime}  Vol: ${vol.label}\nExpected net: $${expectedNetUsd}  Gas: $${gasCostUsd.toFixed(4)}\nLock-after-trade wired: ${FLAG_LOCK_AFTER_TRADE ? 'YES' : 'NO'}\nNo broadcast (--dry).`,
        'INFO'
      );
      return;
    }

    // ── BROADCAST (the one trade) ──
    const deadline = pass2.deadline;
    let tx, txHash;
    try {
      tx = await executorRW.executeRamsesArb(
        USDC, TRADE_SIZE_USDC_MICRO, minProfitMicro,
        mins.amountOutMinA, mins.amountOutMinB, DIRECTION_RAMSES_FIRST, deadline,
        { gasLimit: BigInt(Math.ceil(gasEstimate * 1.25)) }
      );
      txHash = tx.hash;
      emit('TX_SUBMITTED', { txHash, gasLimit: Math.ceil(gasEstimate * 1.25) });
    } catch (e) {
      emit('TX_SUBMIT_FAILED', { error: (e.message||'').slice(0,140) });
      // Do NOT loop — this counts as our single attempt. Flip flags + stop.
      flipEnvFlag('AUTO_MICRO_ONESHOT', 'false');
      if (FLAG_LOCK_AFTER_TRADE) flipEnvFlag('LIVE_DEPLOY_APPROVED', 'false');
      writeFinalJson({
        status: 'SUBMIT_FAILED',
        reason: (e.message||'').slice(0,200),
        spreadBps, regime, expectedNetUsd, gasCostUsd: +gasCostUsd.toFixed(4),
      });
      await discordNotify(
        'candidate',
        '🔴 AllMight micro-live SUBMIT FAILED',
        `Could not broadcast trade.\nError: ${(e.message||'').slice(0,200)}\nFlags reset; system locked.`,
        'FAILED'
      );
      return;
    }

    // ── Wait for receipt ──
    let receipt;
    try {
      const wait = tx.wait(1);
      const timeout = sleep(RECEIPT_TIMEOUT_MS).then(() => { throw new Error('RECEIPT_TIMEOUT'); });
      receipt = await Promise.race([wait, timeout]);
    } catch (e) {
      emit('TX_RECEIPT_TIMEOUT_OR_ERROR', { error: (e.message||'').slice(0,140), txHash });
      flipEnvFlag('AUTO_MICRO_ONESHOT', 'false');
      if (FLAG_LOCK_AFTER_TRADE) flipEnvFlag('LIVE_DEPLOY_APPROVED', 'false');
      writeFinalJson({
        status: 'RECEIPT_PENDING_OR_FAILED',
        txHash, reason: (e.message||'').slice(0,200),
      });
      await discordNotify(
        'candidate',
        '🟡 AllMight micro-live RECEIPT PENDING',
        `Tx submitted but no receipt within ${RECEIPT_TIMEOUT_MS/1000}s.\nTxHash: ${txHash}\nManual review required.`,
        'DEGRADED'
      );
      return;
    }

    // ── Parse receipt + compute realized ──
    const gasUsed     = receipt.gasUsed;
    const gasCostEth  = parseFloat(ethers.formatEther(gasUsed * (gasPriceWei || 0n)));
    const gasCostUsdR = gasCostEth * ETH_USD_FALLBACK;

    // Try to parse ArbExecuted event for actual on-chain profit
    let onChainProfitUsdc = null;
    try {
      const iface = new ethers.Interface(EXECUTOR_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'ArbExecuted') {
            onChainProfitUsdc = Number(parsed.args.profit) / 1e6;
            break;
          }
        } catch { /* not our event */ }
      }
    } catch { /* fail-soft */ }

    const realizedNetUsd = onChainProfitUsdc != null
      ? +(onChainProfitUsdc - gasCostUsdR).toFixed(4)
      : null;

    emit('TX_RECEIPT', {
      txHash,
      block: receipt.blockNumber,
      status: receipt.status === 1 ? 'SUCCESS' : 'REVERTED',
      gasUsed: gasUsed.toString(),
      gasCostUsd: +gasCostUsdR.toFixed(4),
      onChainProfitUsdc,
      realizedNetUsd,
    });

    // ── Flip flags ──
    flipEnvFlag('AUTO_MICRO_ONESHOT', 'false');
    if (FLAG_LOCK_AFTER_TRADE) flipEnvFlag('LIVE_DEPLOY_APPROVED', 'false');

    // ── Final JSON ──
    writeFinalJson({
      status: receipt.status === 1 ? 'EXECUTED' : 'REVERTED_ON_CHAIN',
      tradedAt: new Date().toISOString(),
      txHash,
      block: receipt.blockNumber,
      spreadBps,
      regime,
      volatility: vol.label,
      gasUnits: Number(gasUsed),
      gasPriceGwei: +gasPriceGwei.toFixed(6),
      gasCostUsd: +gasCostUsdR.toFixed(4),
      onChainProfitUsdc,
      expectedNetUsd,
      realizedNetUsd,
      walletEth: +walletEth.toFixed(6),
      executorAddress: EXECUTOR_ADDRESS,
      signalBlock: candidate.block,
      lockedAfterTrade: FLAG_LOCK_AFTER_TRADE,
    });

    // ── Discord ──
    const verdict = receipt.status === 1 ? 'SUCCESS' : 'ON-CHAIN REVERT';
    const icon    = receipt.status === 1 ? '✅' : '🔴';
    const realStr = realizedNetUsd != null ? `$${realizedNetUsd}` : '(unparsed)';
    await discordNotify(
      'candidate',
      `${icon} AllMight micro-live ${verdict}`,
      [
        `**TxHash:** \`${txHash}\``,
        `**Block:** ${receipt.blockNumber}`,
        `**Spread:** ${spreadBps}bps  **Regime:** ${regime}`,
        `**Gas:** ${gasUsed.toString()} units @ ${gasPriceGwei.toFixed(4)} gwei = $${gasCostUsdR.toFixed(4)}`,
        `**Expected net:** $${expectedNetUsd}`,
        `**Realized net:** ${realStr}`,
        ``,
        `Flags reset. AUTO_MICRO_ONESHOT=false${FLAG_LOCK_AFTER_TRADE ? ', LIVE_DEPLOY_APPROVED=false' : ''}.`,
        `System will not auto-trade again without Boss ruling.`,
      ].join('\n'),
      receipt.status === 1 ? 'HEALTHY' : 'FAILED'
    );

    return;   // exit watch loop — single trade attempted, done
  }

  // ── Timeout: no qualifying signal within MAX_WAIT_SEC ──
  emit('TIMEOUT_NO_SIGNAL', { maxWaitSec: MAX_WAIT_SEC });
  writeFinalJson({ status: 'TIMEOUT_NO_SIGNAL', maxWaitSec: MAX_WAIT_SEC });
  await discordNotify(
    'ops',
    'ℹ️ AllMight micro-live TIMEOUT',
    `No qualifying signal within ${MAX_WAIT_SEC}s.\nFlags unchanged. AUTO_MICRO_ONESHOT remains armed for next run.`,
    'INFO'
  );
}

// ─── ENTRYPOINT ──────────────────────────────────────────────────────────────

main().catch(e => {
  // Last-ditch fail-closed
  console.error('Fatal unexpected error:', e.message);
  emit('FATAL_UNEXPECTED', { error: (e.message||'').slice(0,200) });
  writeFinalJson({ status: 'FATAL_UNEXPECTED', reason: (e.message||'').slice(0,200) });
  process.exit(0);
});
