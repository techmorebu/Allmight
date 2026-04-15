'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Dense Price Replay Generator  v2.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/generate_price_replay.js
//  STATUS    : UPGRADED — Boss ruling 2026-04-15 (v1.0 → v2.0)
//
//  CHANGE FROM v1.0
//  ─────────────────
//  v1.0 pulled only from activator `signal` records.
//  v2.0 pulls from ALL activator record types that carry venue-side prices,
//  then de-duplicates and sorts chronologically.
//
//  SOURCE PRIORITY (density audit findings 2026-04-15):
//    1. signal records         — both uniPrice + camPrice  (639 records, 2 venues each)
//    2. state_transition records — uniPrice only           (213 records, entry venue)
//
//  Heartbeats, ready_check_confirmed, tick_map_refresh: no per-venue prices — skipped.
//  rpc_freshness.jsonl: provider telemetry only — skipped.
//
//  HONEST DENSITY CEILING
//  ───────────────────────
//  Median inter-row gap after combining sources: ~12s for entry venue, ~44s for exit venue.
//  12s > 2s tolerance for 500ms delay analysis → sub-second delay sandbox still data-limited.
//  To reach 1–5s density, a tick logger must be added to the activator loop (future work).
//
//  OUTPUT SCHEMA (canonical — unchanged from v1.0)
//  ─────────────────────────────────────────────────
//    ts, sessionId, pair, venue, chain, price, feeBps, spreadPctObserved,
//    liquidityUsd, depthMinUsd, blockNumber, sourceType, sourceRef,
//    profile, regime, heatClass, heatScore
//
//  USAGE
//    node scripts/tools/generate_price_replay.js --session logs/session_YYYYMMDD_HHMM
//    node scripts/tools/generate_price_replay.js --session logs/session_YYYYMMDD_HHMM --dry-run
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const ARGS    = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const SES_DIR = (() => { const i = ARGS.indexOf('--session'); return i !== -1 ? ARGS[i+1] : null; })();

// Fee lookup from validated venue pool configurations
const VENUE_FEE_BPS = {
  'uniswap_v3' : 1,   // 0.01% pool (ETH/USDC-RAMSES surface)
  'ramses_v2'  : 5,   // 0.05% pool
  'camelot_v3' : 1,
  'default'    : 5,
};
const feeBps = v => VENUE_FEE_BPS[v] ?? VENUE_FEE_BPS['default'];

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).reduce((acc, l) => {
    try { acc.push(JSON.parse(l)); } catch {}
    return acc;
  }, []);
}

// ─── GAP STATISTICS ───────────────────────────────────────────────────────────

function gapStats(timestamps) {
  const epochs = timestamps.map(t => Date.parse(t)).filter(e => isFinite(e)).sort((a,b)=>a-b);
  if (epochs.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < epochs.length; i++) gaps.push((epochs[i] - epochs[i-1]) / 1000);
  const sorted = gaps.slice().sort((a,b)=>a-b);
  return {
    count  : epochs.length,
    minGap : +sorted[0].toFixed(1),
    maxGap : +sorted[sorted.length-1].toFixed(1),
    avgGap : +(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(1),
    medGap : +sorted[Math.floor(sorted.length/2)].toFixed(1),
  };
}

// ─── REPLAY ROW FACTORY ───────────────────────────────────────────────────────

function makeRow(ts, sessionId, pair, venue, chain, price, block, sourceType, opts = {}) {
  return {
    ts, sessionId, pair, venue, chain,
    price              : price,
    feeBps             : feeBps(venue),
    spreadPctObserved  : opts.spread ?? null,
    liquidityUsd       : opts.liquidityUsd ?? null,
    depthMinUsd        : opts.depthMin ?? null,
    blockNumber        : block ?? null,
    sourceType,
    sourceRef          : 'activator.jsonl',
    profile            : opts.profile ?? null,
    regime             : opts.regime ?? null,
    heatClass          : opts.heatClass ?? null,
    heatScore          : opts.heatScore ?? null,
    meta               : { tick: opts.tick ?? null, endpointsSeen: [] },
  };
}

// ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

function generateReplay(sessionDir) {
  const actPath = path.join(sessionDir, 'activator.jsonl');
  if (!fs.existsSync(actPath)) {
    console.error(`[generate_price_replay] activator.jsonl not found in ${sessionDir}`);
    process.exit(1);
  }

  const sessionId = path.basename(sessionDir).replace('session_', '');
  const records   = readJsonl(actPath).filter(r => r.ts);

  if (!records.length) {
    console.error('[generate_price_replay] No timestamped records found in activator.jsonl');
    process.exit(1);
  }

  const rows       = [];
  const pairsSet   = new Set();
  const venuesSet  = new Set();
  const sourceCounts = {};

  for (const rec of records) {
    const ts    = rec.ts;
    const pair  = rec.pair ?? 'ETH/USDC-RAMSES';
    const chain = rec.chain ?? 'arbitrum';
    const block = rec.block ?? rec.blockNumber ?? null;
    const opts  = {
      spread    : rec.spread ?? rec.netSpreadFrac ? rec.netSpreadFrac * 100 : null,
      depthMin  : rec.depthMin ?? null,
      profile   : rec.activeProfile ?? null,
      regime    : rec.regime ?? null,
      heatClass : rec.heatClass ?? null,
      heatScore : rec.heatScore ?? null,
    };

    // ── SOURCE 1: signal records — both venues ────────────────────────────
    if (rec.type === 'signal') {
      if (rec.uniPrice) {
        pairsSet.add(pair); venuesSet.add('uniswap_v3');
        opts.liquidityUsd = rec.uniDepth ?? null;
        opts.depthMin     = rec.uniDepth ?? null;
        rows.push(makeRow(ts, sessionId, pair, 'uniswap_v3', chain, rec.uniPrice, block, 'signal_uniswap', opts));
        sourceCounts.signal_uni = (sourceCounts.signal_uni || 0) + 1;
      }
      if (rec.camPrice) {
        pairsSet.add(pair); venuesSet.add('ramses_v2');
        rows.push(makeRow(ts, sessionId, pair, 'ramses_v2', chain, rec.camPrice, block, 'signal_ramses', opts));
        sourceCounts.signal_cam = (sourceCounts.signal_cam || 0) + 1;
      }
    }

    // ── SOURCE 2: state_transition — entry venue price at ARM/DISARM events ──
    // These fire at PASSIVE→ARMED and ARMED→PASSIVE transitions,
    // giving additional uniswap_v3 price observations between signals.
    else if (rec.type === 'state_transition' && rec.uniPrice) {
      pairsSet.add(pair); venuesSet.add('uniswap_v3');
      opts.depthMin     = rec.depthMin ?? null;
      opts.liquidityUsd = rec.depthMin ?? null;
      rows.push(makeRow(ts, sessionId, pair, 'uniswap_v3', chain, rec.uniPrice, block, 'state_transition', opts));
      sourceCounts.state_tx = (sourceCounts.state_tx || 0) + 1;
    }
  }

  // ── De-duplicate: same ts + venue → keep first ───────────────────────────
  const seen    = new Set();
  const deduped = rows.filter(r => {
    const key = `${r.ts}::${r.venue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Sort chronologically ──────────────────────────────────────────────────
  deduped.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const firstTs = deduped[0]?.ts ?? null;
  const lastTs  = deduped[deduped.length - 1]?.ts ?? null;

  // ── Gap statistics per venue ──────────────────────────────────────────────
  const venueStats = {};
  for (const venue of venuesSet) {
    const vRows = deduped.filter(r => r.venue === venue);
    venueStats[venue] = { rows: vRows.length, gaps: gapStats(vRows.map(r => r.ts)) };
  }

  const manifest = {
    sessionId,
    generatedAt  : new Date().toISOString(),
    generatorVersion: '2.0',
    sourceFiles  : ['activator.jsonl'],
    sources      : sourceCounts,
    pairs        : [...pairsSet],
    venues       : [...venuesSet],
    rows         : deduped.length,
    rowsBeforeDedupe: rows.length,
    timeRange    : { start: firstTs, end: lastTs },
    venueStats,
    notes: [
      'v2.0: combines signal records (both venues) + state_transition records (entry venue)',
      'Median inter-row gap ≈12s for entry venue during active windows',
      'Sub-second delay sandbox requires tick logger on activator loop (future work)',
    ].join(' | '),
  };

  if (DRY_RUN) {
    console.log(`[dry-run] Would write ${deduped.length} rows (${rows.length} before dedupe)`);
    console.log('[dry-run] Source counts:', sourceCounts);
    console.log('[dry-run] Venue stats:', JSON.stringify(venueStats, null, 2));
    return;
  }

  const replayPath   = path.join(sessionDir, 'price_replay.jsonl');
  const manifestPath = path.join(sessionDir, 'price_replay_manifest.json');
  fs.writeFileSync(replayPath, deduped.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[generate_price_replay v2.0]`);
  console.log(`  ✓ ${deduped.length} rows → ${replayPath}`);
  console.log(`  ✓ manifest → ${manifestPath}`);
  console.log(`  Source breakdown: ${JSON.stringify(sourceCounts)}`);
  for (const [venue, stat] of Object.entries(venueStats)) {
    const g = stat.gaps;
    if (g) console.log(`  ${venue}: ${stat.rows} rows  med=${g.medGap}s  min=${g.minGap}s  max=${g.maxGap}s  avg=${g.avgGap}s`);
  }
  console.log(`  Time range: ${firstTs?.slice(0,19)} → ${lastTs?.slice(0,19)}`);
}

if (!SES_DIR) {
  console.error('[generate_price_replay] --session <path> required');
  process.exit(1);
}

generateReplay(SES_DIR);
