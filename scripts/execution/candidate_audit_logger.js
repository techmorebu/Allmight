'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Candidate Audit Logger  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/candidate_audit_logger.js
//  Thin I/O wrapper. All computation in candidate_audit.js.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DEFAULT_AUDIT_LOG = path.resolve(
  process.cwd(),
  process.env.AUDIT_LOG_PATH || 'logs/execution_candidate_audit.jsonl'
);

function ensureDir(p) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent */ }
}

/**
 * Append one audit record to JSONL log.
 * @param {object}  record   From auditCandidate()
 * @param {string} [filePath]
 * @returns {boolean}
 */
function logAuditRecord(record, filePath) {
  const target = filePath || DEFAULT_AUDIT_LOG;
  try {
    ensureDir(target);
    fs.appendFileSync(target, JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch (err) {
    process.stderr.write(`[candidate_audit_logger] write failed: ${err.message}\n`);
    return false;
  }
}

/**
 * Summarise an audit log.
 * @param {string} [filePath]
 * @returns {{ count, confirmed, nearMiss, rejected, byReason }}
 */
function inspectAuditLog(filePath) {
  const target = filePath || DEFAULT_AUDIT_LOG;
  if (!fs.existsSync(target)) {
    return { count: 0, confirmed: 0, nearMiss: 0, rejected: 0, byReason: {} };
  }
  try {
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    let confirmed = 0, nearMiss = 0, rejected = 0;
    const byReason = {};
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.auditVerdict === 'CANDIDATE_CONFIRMED') confirmed++;
        else if (r.auditVerdict === 'CANDIDATE_NEAR_MISS') nearMiss++;
        else rejected++;
        const rsn = r.auditReason || 'unknown';
        byReason[rsn] = (byReason[rsn] || 0) + 1;
      } catch { /* skip */ }
    }
    return { count: lines.length, confirmed, nearMiss, rejected, byReason };
  } catch {
    return { count: 0, confirmed: 0, nearMiss: 0, rejected: 0, byReason: {} };
  }
}

module.exports = { logAuditRecord, inspectAuditLog, DEFAULT_AUDIT_LOG };
