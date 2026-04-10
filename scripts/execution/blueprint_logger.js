'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Blueprint Logger  v1.0  (Execution Design Layer)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/blueprint_logger.js
//  STATUS    : NEW — Boss ruling 2026-04-10
//
//  PURPOSE
//  ─────────
//  Append trade blueprints to logs/trade_blueprints.jsonl.
//  Thin I/O wrapper — all computation lives in trade_blueprint_engine.js.
//
//  USAGE (from activator or any caller)
//  ─────
//  const { logBlueprint } = require('./blueprint_logger');
//  logBlueprint(blueprint);
//
//  Or with a custom path:
//  const logger = createBlueprintLogger('./logs/blueprints_eth_usdc.jsonl');
//  logger.logBlueprint(blueprint);
//
//  OUTPUT
//  ──────
//  logs/trade_blueprints.jsonl — one JSON object per line, newline-delimited.
//  Each line is a complete, self-contained blueprint record.
//  File is append-only — never truncated by this module.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// Default path — relative to process.cwd() (repo root)
const DEFAULT_BLUEPRINT_LOG = path.resolve(
  process.cwd(),
  process.env.BLUEPRINT_LOG_PATH || 'logs/trade_blueprints.jsonl'
);

/**
 * Ensure the log directory exists. Silent on error — never blocks a caller.
 */
function ensureDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent — never block */ }
}

/**
 * Append a single blueprint record to a JSONL file.
 *
 * Fails silently — a logging failure must never crash the activator.
 * Errors are written to stderr for visibility without disrupting the caller.
 *
 * @param {object} blueprint  Serializable blueprint from trade_blueprint_engine.js
 * @param {string} [filePath] Optional override (default: logs/trade_blueprints.jsonl)
 * @returns {boolean}  true if written successfully, false on error
 */
function logBlueprint(blueprint, filePath) {
  const target = filePath || DEFAULT_BLUEPRINT_LOG;
  try {
    ensureDir(target);
    const line = JSON.stringify(blueprint) + '\n';
    fs.appendFileSync(target, line, 'utf8');
    return true;
  } catch (err) {
    process.stderr.write(`[blueprint_logger] write failed: ${err.message}\n`);
    return false;
  }
}

/**
 * Create a scoped blueprint logger bound to a specific file path.
 * Useful when the activator wants a run-specific log file.
 *
 * @param {string} filePath
 * @returns {{ logBlueprint: function, filePath: string }}
 */
function createBlueprintLogger(filePath) {
  ensureDir(filePath);
  return {
    filePath,
    logBlueprint: (blueprint) => logBlueprint(blueprint, filePath),
  };
}

/**
 * Read and count blueprints in a log file.
 * Utility for quick validation — not called in production path.
 *
 * @param {string} [filePath]
 * @returns {{ count: number, viable: number, degraded: number }}
 */
function inspectBlueprintLog(filePath) {
  const target = filePath || DEFAULT_BLUEPRINT_LOG;
  if (!fs.existsSync(target)) return { count: 0, viable: 0, degraded: 0 };
  try {
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    let viable = 0, degraded = 0;
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r._degraded) degraded++;
        else if (r.viability?.spreadAboveFloor) viable++;
      } catch { /* skip malformed */ }
    }
    return { count: lines.length, viable, degraded };
  } catch {
    return { count: 0, viable: 0, degraded: 0 };
  }
}

module.exports = {
  logBlueprint,
  createBlueprintLogger,
  inspectBlueprintLog,
  DEFAULT_BLUEPRINT_LOG,
};
