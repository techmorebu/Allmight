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
  if (!url) {
    // Channel not configured — silent skip, not an error
    return false;
  }

  // Soft rate-limit — ensure min gap between sends on same channel
  const now = Date.now();
  const gap  = now - (_lastSent[channel] || 0);
  if (gap < MIN_SEND_GAP_MS) {
    await _sleep(MIN_SEND_GAP_MS - gap);
  }
  _lastSent[channel] = Date.now();

  try {
    // Discord requires either `content` (plain text) or `embeds` to show anything.
    // Adding `content` as a one-line summary ensures the message is never blank
    // even if the embed fails to render on some clients. Matches the working
    // pattern from utils/discord_notifier.js and scripts/test_discord.py.
    const contentLine = embed.title ? `**${embed.title}**` : 'AllMight notification';

    const res = await fetch(url, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        username  : 'AllMight',
        content   : contentLine,   // ensures message is never blank
        embeds    : [embed],
      }),
    });

    if (!res.ok) {
      process.stderr.write(
        `[discord_notifier] ${channel} send failed: HTTP ${res.status}\n`
      );
      return false;
    }
    return true;
  } catch (err) {
    process.stderr.write(
      `[discord_notifier] ${channel} send error: ${err.message}\n`
    );
    return false;
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── TYPED SENDERS ────────────────────────────────────────────────────────────

/**
 * Send an ops alert (health/watchdog events).
 *
 * @param {{ title, description, status, fields, footer }} opts
 */
async function sendOpsNotification({ title, description, status = 'INFO', fields = [], footer }) {
  const colour = COLOURS[status] ?? COLOURS.INFO;
  return sendEmbed('ops', {
    title,
    description,
    color  : colour,
    fields : fields.map(f => ({ name: f.name, value: String(f.value), inline: f.inline ?? true })),
    footer : footer ? { text: footer } : { text: `AllMight  •  ${new Date().toUTCString()}` },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send a candidate alert (confirmed execution candidate).
 *
 * @param {{ pair, spreadPct, executionConfidence, baseNetProfitUsd,
 *           profile, heatClass, regime, direction, sessionId, extra }} opts
 */
async function sendCandidateNotification(opts) {
  const {
    pair                = 'ETH/USDC-RAMSES',
    spreadPct,
    executionConfidence,
    baseNetProfitUsd,
    profile             = '?',
    heatClass           = '?',
    regime              = '?',
    direction           = '?',
    sessionId           = '?',
    extra               = '',
  } = opts;

  const fields = [
    { name: 'Spread',      value: spreadPct != null           ? `${spreadPct.toFixed(4)}%`         : '?' },
    { name: 'Confidence',  value: executionConfidence != null ? executionConfidence.toFixed(3)      : '?' },
    { name: 'Net Profit',  value: baseNetProfitUsd != null    ? `$${baseNetProfitUsd.toFixed(2)}`   : '?' },
    { name: 'Profile',     value: profile },
    { name: 'Heat',        value: heatClass },
    { name: 'Regime',      value: regime.replace('_regime', '').replace('_', ' ') },
    { name: 'Direction',   value: direction.replace(/_/g, '/').toLowerCase().slice(0, 30) },
    { name: 'Session',     value: sessionId },
  ];

  return sendEmbed('candidate', {
    title      : `🔥  EXECUTION CANDIDATE — ${pair}`,
    description: extra || 'A blueprint passed all three filter gates.',
    color      : COLOURS.CANDIDATE,
    fields     : fields.map(f => ({ name: f.name, value: f.value, inline: true })),
    timestamp  : new Date().toISOString(),
    footer     : { text: 'AllMight  •  Candidate Audit Layer' },
  });
}

/**
 * Send a session summary (stop/periodic digest).
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

  const icon = confirmed > 0 ? '📊' : '📋';
  const colour = confirmed > 0 ? COLOURS.CANDIDATE : COLOURS.SUMMARY;

  const fields = [
    { name: 'Duration',        value: typeof durationH === 'number' ? `${durationH.toFixed(1)}h` : String(durationH) },
    { name: 'Signals',         value: String(signals) },
    { name: 'Blueprints',      value: String(blueprints) },
    { name: 'CONFIRMED',       value: `**${confirmed}**` },
    { name: 'Near-miss',       value: String(nearMiss) },
    { name: 'Threshold-edge',  value: String(thresholdEdge) },
    { name: 'Accum verdict',   value: accumVerdict },
    { name: 'Rebuilds',        value: String(rebuilds) },
    { name: 'UNKNOWN heat',    value: String(unknownHeat) },
  ];

  return sendEmbed('summary', {
    title      : `${icon}  SESSION SUMMARY — ${sessionId}`,
    color      : colour,
    fields     : fields.map(f => ({ name: f.name, value: f.value, inline: true })),
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
