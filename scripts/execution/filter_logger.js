'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Filter Logger  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/filter_logger.js
//  STATUS    : NEW — Boss ruling 2026-04-10
//
//  PURPOSE
//  ─────────
//  Append filter decisions to logs/execution_filter_results.jsonl.
//  Thin I/O wrapper. All computation in execution_filter.js.
//  Logging failures must never crash the caller.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DEFAULT_FILTER_LOG = path.resolve(
  process.cwd(),
  process.env.FILTER_LOG_PATH || 'logs/execution_filter_results.jsonl'
);

function ensureDir(p) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent */ }
}

/**
 * Append one filter decision to JSONL log.
 * @param {object}  decision  From applyFilter()
 * @param {string} [filePath] Override path
 * @returns {boolean}
 */
function logFilterDecision(decision, filePath) {
  const target = filePath || DEFAULT_FILTER_LOG;
  try {
    ensureDir(target);
    fs.appendFileSync(target, JSON.stringify(decision) + '\n', 'utf8');
    return true;
  } catch (err) {
    process.stderr.write(`[filter_logger] write failed: ${err.message}\n`);
    return false;
  }
}

/**
 * Count and summarise a filter log.
 * @param {string} [filePath]
 * @returns {{ count, allow, reject, byClass, byReason }}
 */
function inspectFilterLog(filePath) {
  const target = filePath || DEFAULT_FILTER_LOG;
  if (!fs.existsSync(target)) {
    return { count: 0, allow: 0, reject: 0, byClass: {}, byReason: {} };
  }
  try {
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    let allow = 0, reject = 0;
    const byClass = {}, byReason = {};
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.filterDecision === 'ALLOW') allow++;
        else reject++;
        const cls = r.candidateClass || 'unknown';
        byClass[cls]  = (byClass[cls]  || 0) + 1;
        const rsn = r.filterReason || 'unknown';
        byReason[rsn] = (byReason[rsn] || 0) + 1;
      } catch { /* skip */ }
    }
    return { count: lines.length, allow, reject, byClass, byReason };
  } catch {
    return { count: 0, allow: 0, reject: 0, byClass: {}, byReason: {} };
  }
}

module.exports = { logFilterDecision, inspectFilterLog, DEFAULT_FILTER_LOG };
