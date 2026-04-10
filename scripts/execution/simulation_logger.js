'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Simulation Logger  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/simulation_logger.js
//  STATUS    : NEW — Boss ruling 2026-04-10
//
//  PURPOSE
//  ─────────
//  Append simulation results to logs/execution_simulations.jsonl.
//  Thin I/O wrapper — all computation lives in execution_simulator.js.
//  Logging failures must never crash the caller.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DEFAULT_SIM_LOG = path.resolve(
  process.cwd(),
  process.env.SIM_LOG_PATH || 'logs/execution_simulations.jsonl'
);

function ensureDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* silent */ }
}

/**
 * Append one simulation result to JSONL log.
 * Fail-silent — never throws.
 *
 * @param {object} simResult  From simulateBlueprint()
 * @param {string} [filePath] Override log path
 * @returns {boolean}  true = written, false = error
 */
function logSimulation(simResult, filePath) {
  const target = filePath || DEFAULT_SIM_LOG;
  try {
    ensureDir(target);
    fs.appendFileSync(target, JSON.stringify(simResult) + '\n', 'utf8');
    return true;
  } catch (err) {
    process.stderr.write(`[simulation_logger] write failed: ${err.message}\n`);
    return false;
  }
}

/**
 * Inspect simulation log — counts and verdict distribution.
 * For validation and quick health checks.
 *
 * @param {string} [filePath]
 * @returns {{ count, pass, marginal, fail, degraded }}
 */
function inspectSimLog(filePath) {
  const target = filePath || DEFAULT_SIM_LOG;
  if (!fs.existsSync(target)) return { count: 0, pass: 0, marginal: 0, fail: 0, degraded: 0 };
  try {
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    let pass = 0, marginal = 0, fail = 0, degraded = 0;
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r._degraded) { degraded++; continue; }
        const v = r.summary?.simulationVerdict;
        if (v === 'SIM_PASS')     pass++;
        else if (v === 'SIM_MARGINAL') marginal++;
        else if (v === 'SIM_FAIL')     fail++;
      } catch { /* skip */ }
    }
    return { count: lines.length, pass, marginal, fail, degraded };
  } catch {
    return { count: 0, pass: 0, marginal: 0, fail: 0, degraded: 0 };
  }
}

module.exports = { logSimulation, inspectSimLog, DEFAULT_SIM_LOG };
