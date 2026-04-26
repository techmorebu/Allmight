#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  scripts/tools/log_retention_manager.js
//  PROJECT ALLMIGHT — Log Retention + Storage Management  v1.0
//
//  3-tier storage model:
//    HOT  — active session raw logs (never touched)
//    WARM — completed sessions, compressed to tar.gz, critical files preserved
//    COLD — sessions older than COLD_DAYS, archive only unless milestone-flagged
//
//  Usage:
//    node scripts/tools/log_retention_manager.js --status
//    node scripts/tools/log_retention_manager.js --archive --dry-run
//    node scripts/tools/log_retention_manager.js --archive
//    node scripts/tools/log_retention_manager.js --prune --dry-run
//    node scripts/tools/log_retention_manager.js --prune
//    node scripts/tools/log_retention_manager.js --scan
//    node scripts/tools/log_retention_manager.js --self-test
//
//  Safety guarantees:
//    - Never touches active session (reads logs/allmight.session)
//    - Never deletes unverified archive (tar -tzf must pass before rm)
//    - Never deletes project_metrics/
//    - Keeps last 2 completed sessions raw (recent reference)
//    - Keeps sessions marked with .keep file (milestone flag)
//    - Dry-run mode previews all changes without executing
// ═══════════════════════════════════════════════════════════════════════════════

const fs          = require('fs');
const path        = require('path');
const { execSync, spawnSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────
const LOGS_DIR       = path.resolve(process.cwd(), 'logs');
const SESSIONS_DIR   = path.join(LOGS_DIR, 'sessions');
const ARCHIVES_DIR   = path.join(LOGS_DIR, 'archives');
const METRICS_DIR    = path.join(LOGS_DIR, 'project_metrics');
const REPORTS_DIR    = path.join(LOGS_DIR, 'reports');
const SESSION_FILE   = path.join(LOGS_DIR, 'allmight.session');

const WARM_KEEP_LAST = Number(process.env.RETENTION_KEEP_LAST      ?? 2);   // always keep N most recent raw
const WARM_DAYS      = Number(process.env.RETENTION_WARM_DAYS       ?? 14);  // days before cold tier
const COLD_DAYS      = Number(process.env.RETENTION_COLD_DAYS       ?? 30);  // days before cold prune
const DRY_RUN_DEFAULT= false;

// Files to extract uncompressed alongside the archive (critical, small, frequently read)
const CRITICAL_FILES = [
  'activator.jsonl',
  'blueprints.jsonl',
  'execution_candidate_audit.jsonl',
  'sandbox_results.json',
  'session_totals.json',
  'analysis.log',
  'watchdog.jsonl',
  'size_ladder_accumulator.json',
  'threshold_edge_accumulator.json',
  'near_miss_analysis.json',
  'threshold_edge_accumulator.json',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg)  { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('  ⚠️  ' + msg + '\n'); }

function fmtBytes(bytes) {
  if (bytes < 1024)              return `${bytes}B`;
  if (bytes < 1024 * 1024)      return `${(bytes/1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes/1024/1024).toFixed(1)}MB`;
  return `${(bytes/1024/1024/1024).toFixed(2)}GB`;
}

function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const walk = (p) => {
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        fs.readdirSync(p).forEach(f => walk(path.join(p, f)));
      } else {
        total += stat.size;
      }
    } catch { /* skip unreadable */ }
  };
  walk(dirPath);
  return total;
}

function fileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function nowMs() { return Date.now(); }

function ageDays(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    return (nowMs() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  } catch { return 0; }
}

// ── Active session detection ──────────────────────────────────────────────────
function getActiveSessionId() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const raw = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    return raw || null;
  } catch { return null; }
}

// ── Session folder inventory ──────────────────────────────────────────────────
function scanSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR)
    .filter(d => d.startsWith('session_'))
    .map(d => {
      const fullPath = path.join(SESSIONS_DIR, d);
      try {
        if (!fs.statSync(fullPath).isDirectory()) return null;
        const sessionId = d.replace('session_', '');
        const rawSizeB  = dirSizeBytes(fullPath);
        const keepFlag  = fs.existsSync(path.join(fullPath, '.keep'));
        const ageD      = ageDays(fullPath);
        const archivePath = path.join(ARCHIVES_DIR, `${d}.tar.gz`);
        const hasArchive  = fs.existsSync(archivePath);
        const archiveSizeB= hasArchive ? fileSize(archivePath) : 0;
        return { sessionId, d, fullPath, rawSizeB, keepFlag, ageD, hasArchive, archivePath, archiveSizeB };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

// ── Archive session ───────────────────────────────────────────────────────────
function archiveSession(session, dryRun) {
  const { d, fullPath, archivePath } = session;
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

  if (dryRun) {
    log(`  [DRY-RUN] Would archive: ${d}  (${fmtBytes(session.rawSizeB)} → ~${fmtBytes(Math.round(session.rawSizeB * 0.04))} est.)`);
    return { ok: true, dryRun: true };
  }

  // Step 1: Create tar.gz
  log(`  Archiving ${d} (${fmtBytes(session.rawSizeB)})...`);
  const tarResult = spawnSync('tar', [
    '-czf', archivePath,
    '-C', SESSIONS_DIR,
    d
  ], { stdio: 'pipe' });

  if (tarResult.status !== 0) {
    warn(`Archive failed for ${d}: ${tarResult.stderr?.toString()}`);
    return { ok: false, error: 'tar create failed' };
  }

  // Step 2: Verify archive integrity
  const verifyResult = spawnSync('tar', ['-tzf', archivePath], { stdio: 'pipe' });
  if (verifyResult.status !== 0) {
    warn(`Archive verification failed for ${d}. Keeping raw folder.`);
    try { fs.unlinkSync(archivePath); } catch { /* best effort */ }
    return { ok: false, error: 'tar verify failed' };
  }

  const archiveSizeB = fileSize(archivePath);
  const ratio = session.rawSizeB > 0 ? (1 - archiveSizeB/session.rawSizeB) * 100 : 0;
  log(`  ✅ Archived: ${d}  ${fmtBytes(session.rawSizeB)} → ${fmtBytes(archiveSizeB)} (${ratio.toFixed(0)}% compression)`);

  // Step 3: Preserve critical files in a sidecar directory
  const sidecarDir = path.join(ARCHIVES_DIR, `${d}_critical`);
  fs.mkdirSync(sidecarDir, { recursive: true });
  for (const fname of CRITICAL_FILES) {
    const src = path.join(fullPath, fname);
    const dst = path.join(sidecarDir, fname);
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, dst); } catch { /* best effort */ }
    }
  }

  return { ok: true, archiveSizeB, rawSizeB: session.rawSizeB };
}

// ── Delete raw session folder ─────────────────────────────────────────────────
function deleteRaw(session, dryRun) {
  const { d, fullPath, archivePath } = session;

  // ── Absolute path-level guards (Boss ruling 2026-04-26) ──────────────────
  // These fire regardless of tier classification — belt AND suspenders.
  const PROTECTED_PATHS = [
    path.resolve(METRICS_DIR),   // logs/project_metrics/ — permanent brain
    path.resolve(ARCHIVES_DIR),  // logs/archives/        — compressed memory
  ];
  const resolvedFull = path.resolve(fullPath);
  for (const p of PROTECTED_PATHS) {
    if (resolvedFull === p || resolvedFull.startsWith(p + path.sep)) {
      warn(`HARD BLOCK: refusing to delete protected path: ${fullPath}`);
      return { ok: false, reason: 'protected path' };
    }
  }

  // Must be inside SESSIONS_DIR
  if (!resolvedFull.startsWith(path.resolve(SESSIONS_DIR) + path.sep)) {
    warn(`HARD BLOCK: path is outside sessions dir — refusing: ${fullPath}`);
    return { ok: false, reason: 'outside sessions dir' };
  }

  // Final safety check: archive must exist and be non-zero
  if (!fs.existsSync(archivePath) || fileSize(archivePath) < 100) {
    warn(`Refusing to delete raw ${d}: archive missing or too small.`);
    return { ok: false, reason: 'archive not verified' };
  }

  if (dryRun) {
    log(`  [DRY-RUN] Would delete raw: ${d}  (saves ${fmtBytes(session.rawSizeB)})`);
    return { ok: true, dryRun: true };
  }

  const rmResult = spawnSync('rm', ['-rf', fullPath], { stdio: 'pipe' });
  if (rmResult.status !== 0) {
    warn(`Failed to delete ${fullPath}: ${rmResult.stderr?.toString()}`);
    return { ok: false, reason: 'rm failed' };
  }

  log(`  🗑️  Deleted raw: ${d}  (freed ${fmtBytes(session.rawSizeB)})`);
  return { ok: true, freedBytes: session.rawSizeB };
}

// ── Tier classification ───────────────────────────────────────────────────────
function classifySession(session, activeId, sessions) {
  if (session.sessionId === activeId)                   return 'HOT_ACTIVE';
  if (session.keepFlag)                                 return 'MILESTONE';

  // Last N completed sessions stay raw (warm reference)
  const completedSorted = sessions
    .filter(s => s.sessionId !== activeId)
    .sort((a,b) => b.sessionId.localeCompare(a.sessionId));
  const recents = completedSorted.slice(0, WARM_KEEP_LAST).map(s => s.sessionId);
  if (recents.includes(session.sessionId))             return 'WARM_RECENT';

  if (session.ageD <= WARM_DAYS)                       return 'WARM';
  if (session.ageD <= COLD_DAYS)                       return 'COLD';
  return 'COLD_PRUNE';
}

// ── Commands ──────────────────────────────────────────────────────────────────
function cmdStatus() {
  const activeId = getActiveSessionId();
  const sessions = scanSessions();

  const totalRaw     = sessions.reduce((s, r) => s + r.rawSizeB, 0);
  const totalArchive = sessions.reduce((s, r) => s + r.archiveSizeB, 0);
  const metricsSize  = dirSizeBytes(METRICS_DIR);

  const D = '─'.repeat(62);
  const E = '═'.repeat(62);
  log(`\n${E}`);
  log(`  PROJECT ALLMIGHT — LOG STORAGE STATUS`);
  log(`  ${new Date().toISOString().slice(0, 19)} UTC`);
  log(E);
  log(`\n  Active session: ${activeId ?? 'none'}`);
  log(`\n  STORAGE SUMMARY`);
  log(`  ${D}`);
  log(`  Session folders (raw): ${fmtBytes(totalRaw)}`);
  log(`  Archives (tar.gz):     ${fmtBytes(totalArchive)}`);
  log(`  Project metrics:       ${fmtBytes(metricsSize)}`);
  log(`  Total managed:         ${fmtBytes(totalRaw + totalArchive + metricsSize)}`);

  log(`\n  SESSION INVENTORY (${sessions.length} folders)`);
  log(`  ${D}`);
  log(`  ${'SESSION ID'.padEnd(20)} ${'TIER'.padEnd(14)} ${'RAW SIZE'.padEnd(10)} ${'ARCHIVED'.padEnd(10)} AGE`);
  log(`  ${D}`);

  for (const s of sessions.sort((a,b) => b.sessionId.localeCompare(a.sessionId))) {
    const tier    = classifySession(s, activeId, sessions);
    const tierStr = {
      HOT_ACTIVE:  '🔥 ACTIVE',
      MILESTONE:   '⭐ MILESTONE',
      WARM_RECENT: '🟡 WARM-RECENT',
      WARM:        '🟠 WARM',
      COLD:        '🔵 COLD',
      COLD_PRUNE:  '⛔ COLD-PRUNE',
    }[tier] ?? tier;
    const raw  = s.rawSizeB > 0 ? fmtBytes(s.rawSizeB) : '(deleted)';
    const arch = s.hasArchive ? fmtBytes(s.archiveSizeB) : '—';
    const age  = `${s.ageD.toFixed(0)}d`;
    log(`  ${s.sessionId.padEnd(20)} ${tierStr.padEnd(16)} ${raw.padEnd(10)} ${arch.padEnd(10)} ${age}`);
  }

  const archivable = sessions.filter(s => {
    const tier = classifySession(s, activeId, sessions);
    return ['WARM','COLD','COLD_PRUNE'].includes(tier) && !s.hasArchive && s.rawSizeB > 0;
  });
  const pruneable = sessions.filter(s => {
    const tier = classifySession(s, activeId, sessions);
    return ['COLD','COLD_PRUNE'].includes(tier) && s.hasArchive && s.rawSizeB > 0;
  });

  log(`\n  RECOMMENDED ACTIONS`);
  log(`  ${D}`);
  log(`  Sessions to archive: ${archivable.length}  (est. save: ${fmtBytes(archivable.reduce((s,r)=>s+Math.round(r.rawSizeB*0.96),0))})`);
  log(`  Sessions to prune:   ${pruneable.length}  (saves: ${fmtBytes(pruneable.reduce((s,r)=>s+r.rawSizeB,0))})`);
  if (archivable.length > 0) log(`  Run: node scripts/tools/log_retention_manager.js --archive`);
  if (pruneable.length > 0)  log(`  Run: node scripts/tools/log_retention_manager.js --prune`);
  log(`\n${E}\n`);
}

function cmdArchive(dryRun) {
  const activeId = getActiveSessionId();
  const sessions = scanSessions();
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_DIR,  { recursive: true });

  log(`\n  Archive mode${dryRun ? ' [DRY-RUN]' : ''}  (active: ${activeId ?? 'none'})`);

  let archived = 0; let skipped = 0; let failed = 0;
  let savedBytes = 0;

  for (const s of sessions.sort((a,b) => a.sessionId.localeCompare(b.sessionId))) {
    const tier = classifySession(s, activeId, sessions);

    if (tier === 'HOT_ACTIVE') {
      log(`  ⏭  Skipping active session: ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (tier === 'WARM_RECENT' || tier === 'MILESTONE') {
      log(`  ⏭  Keeping raw (${tier}): ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (s.hasArchive) {
      log(`  ✓  Already archived: ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (s.rawSizeB === 0) {
      skipped++;
      continue;
    }

    const result = archiveSession(s, dryRun);
    if (result.ok) {
      archived++;
      savedBytes += result.rawSizeB ? Math.round(result.rawSizeB * 0.96) : 0;
    } else {
      failed++;
    }
  }

  log(`\n  Archive complete: ${archived} archived, ${skipped} skipped, ${failed} failed`);
  if (!dryRun) log(`  Estimated space saved: ${fmtBytes(savedBytes)}`);
}

function cmdPrune(dryRun) {
  const activeId = getActiveSessionId();
  const sessions = scanSessions();

  log(`\n  Prune mode${dryRun ? ' [DRY-RUN]' : ''}  (active: ${activeId ?? 'none'})`);
  log(`  Rule: delete raw folders only where archive verified + tier COLD or older`);

  let deleted = 0; let skipped = 0; let failed = 0;
  let freedBytes = 0;

  for (const s of sessions.sort((a,b) => a.sessionId.localeCompare(b.sessionId))) {
    const tier = classifySession(s, activeId, sessions);

    // ── Explicit named guards (Boss ruling 2026-04-26) ────────────────────
    if (tier === 'HOT_ACTIVE') {
      log(`  🔥 SKIP [active session]:   ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (tier === 'MILESTONE') {
      log(`  ⭐ SKIP [milestone .keep]:  ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (tier === 'WARM_RECENT') {
      log(`  🟡 SKIP [newest ${WARM_KEEP_LAST} sessions]: ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (tier === 'WARM') {
      log(`  🟠 SKIP [too recent <${WARM_DAYS}d]:  ${s.sessionId}`);
      skipped++;
      continue;
    }
    if (!s.hasArchive) {
      log(`  ⚠️  SKIP [no archive]:       ${s.sessionId}  — run --archive first`);
      skipped++;
      continue;
    }
    if (s.rawSizeB === 0) {
      // Raw already deleted — nothing to do
      skipped++;
      continue;
    }

    const result = deleteRaw(s, dryRun);
    if (result.ok && !result.dryRun) {
      deleted++;
      freedBytes += result.freedBytes ?? 0;
    } else if (result.ok && result.dryRun) {
      deleted++;
      freedBytes += s.rawSizeB;
    } else {
      failed++;
    }
  }

  log(`\n  Prune complete: ${deleted} deleted, ${skipped} skipped, ${failed} failed`);
  log(`  Space freed: ${fmtBytes(freedBytes)}`);
}

function cmdScan() {
  const activeId = getActiveSessionId();
  const sessions = scanSessions();

  log(`\n  Scan: ${sessions.length} session folders in ${SESSIONS_DIR}`);
  for (const s of sessions) {
    const tier = classifySession(s, activeId, sessions);
    log(`  ${s.sessionId}  tier=${tier}  raw=${fmtBytes(s.rawSizeB)}  archived=${s.hasArchive}  age=${s.ageD.toFixed(1)}d  keep=${s.keepFlag}`);
  }
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  const PASS=[]; const FAIL=[];
  const chk = (name, cond) => (cond ? PASS : FAIL).push(name);

  // Test helpers
  chk('fmtBytes 0',         fmtBytes(0) === '0B');
  chk('fmtBytes KB',        fmtBytes(2048).includes('KB') || fmtBytes(2048).includes('MB'));
  chk('fmtBytes MB',        fmtBytes(5*1024*1024).includes('MB'));
  chk('fmtBytes GB',        fmtBytes(2*1024*1024*1024).includes('GB'));

  // Test active session detection
  const active = getActiveSessionId();
  chk('getActiveSessionId returns string or null', active === null || typeof active === 'string');

  // Test tier classification logic
  const mockSessions = [
    { sessionId: '20260401_0000', rawSizeB: 1000, keepFlag: false, ageD: 1,  hasArchive: false, archiveSizeB: 0 },
    { sessionId: '20260402_0000', rawSizeB: 1000, keepFlag: false, ageD: 2,  hasArchive: false, archiveSizeB: 0 },
    { sessionId: '20260315_0000', rawSizeB: 1000, keepFlag: false, ageD: 45, hasArchive: true,  archiveSizeB: 50 },
    { sessionId: '20260310_0000', rawSizeB: 0,    keepFlag: true,  ageD: 50, hasArchive: true,  archiveSizeB: 50 },
  ];
  chk('WARM_RECENT: newest 2 kept',
    classifySession(mockSessions[1], null, mockSessions) === 'WARM_RECENT');
  chk('WARM_RECENT: second newest kept',
    classifySession(mockSessions[0], null, mockSessions) === 'WARM_RECENT');
  chk('COLD_PRUNE: old session',
    classifySession(mockSessions[2], null, mockSessions) === 'COLD_PRUNE');
  chk('MILESTONE: keep-flagged session',
    classifySession(mockSessions[3], null, mockSessions) === 'MILESTONE');
  chk('HOT_ACTIVE: active session',
    classifySession(mockSessions[0], '20260401_0000', mockSessions) === 'HOT_ACTIVE');

  // Test scan (should not crash even with empty dir)
  chk('scanSessions returns array', Array.isArray(scanSessions()));

  // Test dirSizeBytes
  const tmpDir = '/tmp/test_retention_' + Date.now();
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello world');
  const sz = dirSizeBytes(tmpDir);
  chk('dirSizeBytes > 0 for non-empty dir', sz > 0);
  fs.rmSync(tmpDir, { recursive: true });

  // Test CRITICAL_FILES list
  chk('CRITICAL_FILES includes activator.jsonl', CRITICAL_FILES.includes('activator.jsonl'));
  chk('CRITICAL_FILES includes sandbox_results.json', CRITICAL_FILES.includes('sandbox_results.json'));

  // Test tar availability
  const tarCheck = spawnSync('tar', ['--version'], { stdio: 'pipe' });
  chk('tar command available', tarCheck.status === 0);

  const total = PASS.length + FAIL.length;
  log(`\n${'═'.repeat(54)}`);
  log(`  LOG RETENTION MANAGER — SELF-TEST  ${PASS.length}/${total}`);
  log(`${'═'.repeat(54)}`);
  for (const p of PASS) log(`  ✅  ${p}`);
  for (const f of FAIL) log(`  ❌  ${f}`);
  log(`${'═'.repeat(54)}\n`);
  process.exit(FAIL.length > 0 ? 1 : 0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const cmd     = args.find(a => a.startsWith('--') && a !== '--dry-run');
const dryRun  = args.includes('--dry-run') || DRY_RUN_DEFAULT;

fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR,  { recursive: true });
fs.mkdirSync(METRICS_DIR,  { recursive: true });

if      (cmd === '--self-test') selfTest();
else if (cmd === '--status')    cmdStatus();
else if (cmd === '--scan')      cmdScan();
else if (cmd === '--archive')   cmdArchive(dryRun);
else if (cmd === '--prune')     cmdPrune(dryRun);
else {
  log(`
  Project AllMight — Log Retention Manager v1.0

  Usage:
    node scripts/tools/log_retention_manager.js --status
    node scripts/tools/log_retention_manager.js --scan
    node scripts/tools/log_retention_manager.js --archive [--dry-run]
    node scripts/tools/log_retention_manager.js --prune   [--dry-run]
    node scripts/tools/log_retention_manager.js --self-test

  Tier model:
    HOT        — active session (never touched)
    WARM-RECENT— last ${WARM_KEEP_LAST} completed sessions (kept raw)
    MILESTONE  — sessions with .keep file (always preserved)
    WARM       — <${WARM_DAYS}d old (archive candidate)
    COLD       — ${WARM_DAYS}-${COLD_DAYS}d old (archive + prune candidate)
    COLD-PRUNE — >${COLD_DAYS}d old (archive + prune)

  To mark a session as milestone (never auto-delete):
    touch logs/sessions/session_YYYYMMDD_HHMM/.keep

  Storage rules (Boss ruling 2026-04-26):
    Raw logs        = temporary
    Compressed archives = medium-term memory
    Project metrics = permanent brain (NEVER deleted)
    Milestone sessions = protected evidence (NEVER deleted)

  Post-session workflow:
    SESSION=$(cat logs/allmight.session)
    node scripts/tools/project_metrics_tracker.js --session logs/sessions/session_$SESSION
    node scripts/tools/log_retention_manager.js --archive --dry-run
    node scripts/tools/log_retention_manager.js --archive
    node scripts/tools/log_retention_manager.js --status
  `);
}
