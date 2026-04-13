'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Discord Notifier  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/monitoring/discord_notifier.js
//
//  PURPOSE
//  ─────────
//  Send formatted messages to configured Discord webhooks.
//  This is the ONLY module that knows about Discord URLs.
//  All routing logic lives in notification_router.js.
//
//  THIS MODULE DOES NOT:
//  ✗ Read logs or session artifacts
//  ✗ Make routing decisions
//  ✗ Block execution on failure
//  ✗ Crash on Discord errors
//
//  THREE CHANNELS
//  ──────────────
//  ops       — system health, watchdog alerts, stale pipeline warnings
//  candidate — confirmed execution candidates, first-candidate alerts
//  summary   — session stop summaries, periodic digests
//
//  FAIL-SILENT CONTRACT
//  ────────────────────
//  Any Discord error (network down, invalid URL, rate limit) logs to stderr
//  and returns false. The caller MUST continue normally — Discord is not
//  a dependency of the AllMight pipeline.
// ═══════════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');

// ─── CHANNEL CONFIG ───────────────────────────────────────────────────────────

const CHANNELS = Object.freeze({
  ops       : process.env.DISCORD_OPS_WEBHOOK_URL       || '',
  candidate : process.env.DISCORD_CANDIDATE_WEBHOOK_URL || '',
  summary   : process.env.DISCORD_SUMMARY_WEBHOOK_URL   || '',
});

const NOTIFY_ENABLED = process.env.DISCORD_NOTIFY_ENABLED !== 'false';

// Discord rate-limit: max 5 messages per 2 seconds per webhook.
// We add a soft 1s minimum gap between any two sends to the same channel.
const MIN_SEND_GAP_MS = 1000;
const _lastSent = { ops: 0, candidate: 0, summary: 0 };

// ─── EMBED COLOURS ────────────────────────────────────────────────────────────

const COLOURS = Object.freeze({
  HEALTHY  : 0x57F287,  // green
  DEGRADED : 0xFEE75C,  // yellow
  FAILED   : 0xED4245,  // red
  CANDIDATE: 0x5865F2,  // blurple
  SUMMARY  : 0x9B59B6,  // purple
  INFO     : 0x5DADE2,  // blue
});

// ─── CORE SEND ────────────────────────────────────────────────────────────────

/**
 * Send a Discord embed to a named channel.
 * Fail-silent — always returns without throwing.
 *
 * @param {'ops'|'candidate'|'summary'} channel
 * @param {object} embed  Discord embed object
 * @returns {Promise<boolean>}  true = sent, false = skipped/failed
 */
async function sendEmbed(channel, embed) {
  if (!NOTIFY_ENABLED) return false;

  const url = CHANNELS[channel];
  if (!url) return false;

  // Soft rate-limit
  const now = Date.now();
  const gap  = now - (_lastSent[channel] || 0);
  if (gap < MIN_SEND_GAP_MS) await _sleep(MIN_SEND_GAP_MS - gap);
  _lastSent[channel] = Date.now();

  // Plain text only — embeds caused silent render failures on this setup.
  // Build a single readable content string from title + description.
  const title = embed.title ? `**${embed.title}**` : 'AllMight';
  const body  = typeof embed.description === 'string' && embed.description.trim()
    ? embed.description.trim()
    : '';
  const text  = body ? `${title}\n\n${body}` : title;

  try {
    const res = await fetch(url, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ username: 'AllMight', content: text }),
    });

    if (!res.ok) {
      const rb = await res.text().catch(() => '');
      process.stderr.write(`[discord_notifier] ${channel} failed: HTTP ${res.status} ${rb.slice(0,120)}\n`);
      return false;
    }
    return true;
  } catch (err) {
    process.stderr.write(`[discord_notifier] ${channel} error: ${err.message}\n`);
    return false;
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── TYPED SENDERS ────────────────────────────────────────────────────────────

/**
 * OPS ALERT — system health, watchdog, stale pipeline.
 *
 * Boss format:
 *   ⚠️ SYSTEM DEGRADED
 *   Component: activator
 *   Issue: stale output (45s)
 *   Rebuilds: 2
 *   Status: DEGRADED
 *
 * @param {{ title, description, status, component, issue, rebuilds, fields, footer }} opts
 */
async function sendOpsNotification({
  title,
  description,
  status    = 'INFO',
  component = null,
  issue     = null,
  rebuilds  = null,
  fields    = [],
  footer,
}) {
  const colour = COLOURS[status] ?? COLOURS.INFO;

  // Build body text in Boss format — clean line-by-line block
  const lines = [];
  if (component) lines.push(`**Component:** ${component}`);
  if (issue)     lines.push(`**Issue:** ${issue}`);
  if (rebuilds != null) lines.push(`**Rebuilds:** ${rebuilds}`);
  lines.push(`**Status:** ${status}`);
  if (description) lines.push('', description);

  const body = lines.join('\n') || `Status: ${status}`;  // always a non-empty string

  // Extra fields appended below the text block (stale components, dead PIDs, warnings)
  const embedFields = fields.length
    ? fields.map(f => ({ name: f.name, value: String(f.value), inline: f.inline ?? false }))
    : [];

  return sendEmbed('ops', {
    title,
    description: body,
    color      : colour,
    fields     : embedFields,
    footer     : footer ? { text: footer } : { text: `AllMight  •  ${new Date().toUTCString()}` },
    timestamp  : new Date().toISOString(),
  });
}

/**
 * CANDIDATE ALERT — confirmed execution candidate.
 *
 * Boss format:
 *   🔥 EXECUTION CANDIDATE
 *   Pair: ETH/USDC
 *   Spread: 0.142%
 *   Net Edge: 0.031%
 *   Depth: $185,000
 *   Confidence: 0.78
 *   Status: READY
 *
 * @param {{ pair, spreadPct, expectedEdgePct, executionConfidence,
 *           baseNetProfitUsd, profile, heatClass, regime,
 *           direction, sessionId, extra }} opts
 */
async function sendCandidateNotification(opts) {
  const {
    pair              = 'ETH/USDC-RAMSES',
    spreadPct,
    expectedEdgePct,
    executionConfidence,
    baseNetProfitUsd,
    profile           = '?',
    heatClass         = '?',
    regime            = '?',
    direction         = '?',
    sessionId         = '?',
    extra             = '',
  } = opts;

  // Boss-specified line format — clean named block
  const lines = [
    `**Pair:** ${pair}`,
    `**Spread:** ${spreadPct     != null ? spreadPct.toFixed(4) + '%'          : '?'}`,
    `**Net Edge:** ${expectedEdgePct != null ? expectedEdgePct.toFixed(4) + '%' : '?'}`,
    `**Net Profit:** ${baseNetProfitUsd != null ? '$' + baseNetProfitUsd.toFixed(2) : '?'}`,
    `**Confidence:** ${executionConfidence != null ? executionConfidence.toFixed(3) : '?'}`,
    `**Status:** READY`,
    '',
    `Profile: ${profile}  •  Heat: ${heatClass}  •  Regime: ${regime.replace('persistent_depth_regime','persistent').replace('_',' ')}`,
    `Direction: ${direction.replace(/_/g,' ').toLowerCase()}`,
    `Session: ${sessionId}`,
  ];
  if (extra) lines.push('', extra);

  return sendEmbed('candidate', {
    title      : `🔥  EXECUTION CANDIDATE — ${pair}`,
    description: lines.join('\n'),
    color      : COLOURS.CANDIDATE,
    timestamp  : new Date().toISOString(),
    footer     : { text: 'AllMight  •  Candidate Audit Layer' },
  });
}

/**
 * SESSION SUMMARY — stop digest or periodic rollup.
 *
 * Boss format:
 *   📊 SESSION SUMMARY
 *   Duration: 6h
 *   Signals: 1,245
 *   Ready: 87
 *   Candidates: 6
 *   Near Miss: 22
 *   Threshold Edge: 14
 *   Verdict: ACTIVE SURFACE
 *
 * @param {{ sessionId, durationH, signals, blueprints, confirmed,
 *           nearMiss, thresholdEdge, accumVerdict, rebuilds,
 *           unknownHeat, overallStatus }} opts
 */
async function sendSummaryNotification(opts) {
  const {
    sessionId      = '?',
    durationH      = '?',
    signals        = 0,
    blueprints     = 0,
    confirmed      = 0,
    nearMiss       = 0,
    thresholdEdge  = 0,
    accumVerdict   = '?',
    rebuilds       = '?',
    unknownHeat    = 0,
    overallStatus  = 'INFO',
  } = opts;

  const verdict = confirmed > 0 ? 'ACTIVE SURFACE' : 'NO CANDIDATES';
  const icon    = confirmed > 0 ? '📊' : '📋';
  const colour  = confirmed > 0 ? COLOURS.CANDIDATE : COLOURS.SUMMARY;
  const durStr  = typeof durationH === 'number' ? `${parseFloat(durationH).toFixed(1)}h` : String(durationH);

  // Boss-specified summary format — clean line-by-line block
  const lines = [
    `**Duration:** ${durStr}`,
    `**Signals:** ${signals.toLocaleString()}`,
    `**Blueprints:** ${blueprints.toLocaleString()}`,
    `**Candidates:** ${confirmed}`,
    `**Near Miss:** ${nearMiss}`,
    `**Threshold Edge:** ${thresholdEdge}`,
    `**Verdict:** ${verdict}`,
    '',
    `Rebuilds: ${rebuilds}  •  UNKNOWN heat: ${unknownHeat}`,
    `Accumulator: ${accumVerdict}`,
  ];

  return sendEmbed('summary', {
    title      : `${icon}  SESSION SUMMARY — ${sessionId}`,
    description: lines.join('\n'),
    color      : colour,
    timestamp  : new Date().toISOString(),
    footer     : { text: `AllMight  •  ${overallStatus}` },
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  sendEmbed,
  sendOpsNotification,
  sendCandidateNotification,
  sendSummaryNotification,
  CHANNELS,
  NOTIFY_ENABLED,
};
