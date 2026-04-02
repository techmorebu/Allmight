'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Evaluator v1
// ───────────────────────────────────────────────────────────────────────────────
//  PURPOSE
//  Read ranked discovery candidates, group compatible pools into evaluation
//  pairs, and emit a clean evaluation queue for the existing truth tools.
//
//  THIS IS NOT
//  • not a validator
//  • not breakeven truth
//  • not execution logic
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const redis = require('../../utils/redis-client');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : def;
}

const CHAIN = argVal('--chain', 'arbitrum');
const TOP_PAIRS = Number(argVal('--top', 10));
const JSON_OUT = ARGS.includes('--json');

// ─── KEYS ─────────────────────────────────────────────────────────────────────

const RANKED_KEY = `discovery:ranked_candidates:${CHAIN}`;
const QUEUE_KEY = `discovery:evaluation_queue:${CHAIN}`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function lower(v) {
  return String(v || '').toLowerCase();
}

function compatibleGroupKey(row) {
  return `${row.base}|${row.quote}|${row.quoteFamily}`;
}

function sortDeterministic(rows) {
  return rows.sort((a, b) => {
    if ((b.priorityScore || 0) !== (a.priorityScore || 0)) {
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    }
    if ((a.pair || '') !== (b.pair || '')) {
      return (a.pair || '').localeCompare(b.pair || '');
    }
    return (a.quoteFamily || '').localeCompare(b.quoteFamily || '');
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  try {
    const raw = await redis.get(RANKED_KEY);
    if (!raw) {
      throw new Error(`missing redis key: ${RANKED_KEY}`);
    }

    const ranked = JSON.parse(raw);
    const rows = Array.isArray(ranked) ? ranked : [];

    const usable = rows.filter(r =>
      r &&
      r.candidate === true &&
      r.base &&
      r.quote &&
      r.quoteFamily &&
      r.venue &&
      r.poolId
    );

    const grouped = new Map();

    for (const row of usable) {
      const key = compatibleGroupKey(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const queue = [];

    for (const [groupKey, pools] of grouped.entries()) {
      const distinctVenues = [...new Set(pools.map(p => lower(p.venue)).filter(Boolean))];
      if (distinctVenues.length < 2) continue;

      const sortedPools = pools
        .slice()
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      const topPools = sortedPools.slice(0, 4);
      const priorityScore = Number(
        (
          topPools.reduce((sum, p) => sum + (p.score || 0), 0) / Math.max(topPools.length, 1)
        ).toFixed(2)
      );

      queue.push({
        chain: CHAIN,
        pair: topPools[0].pair,
        base: topPools[0].base,
        quote: topPools[0].quote,
        quoteFamily: topPools[0].quoteFamily,
        groupKey,
        venues: [...new Set(topPools.map(p => p.venue))],
        poolIds: topPools.map(p => p.poolId),
        surfaceKeys: topPools.map(p => p.surfaceKey),
        priorityScore,
        reason: [
          'compatible pair across 2+ venues',
          'ranked highly by discovery layer',
          'eligible for exact surface truth checks',
        ],
        generatedAt: nowIso(),
      });
    }

    const sortedQueue = sortDeterministic(queue).slice(0, TOP_PAIRS);

    await redis.set(QUEUE_KEY, JSON.stringify(sortedQueue, null, 2));

    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({
        generatedAt: nowIso(),
        chain: CHAIN,
        count: sortedQueue.length,
        queue: sortedQueue,
      }, null, 2));
      return;
    }

    console.log('\n═'.repeat(100));
    console.log(` AllMight — Surface Evaluator v1 | chain=${CHAIN} | queue=${sortedQueue.length}`);
    console.log('═'.repeat(100));
    for (const item of sortedQueue) {
      console.log(
        `${String(item.priorityScore).padEnd(8)} ` +
        `${String(item.pair).padEnd(14)} ` +
        `${item.venues.join(', ')}`
      );
    }
    console.log('-'.repeat(100));
    console.log(`[evaluator] wrote ${sortedQueue.length} queued pairs → ${QUEUE_KEY}`);

    return {
      generatedAt: nowIso(),
      chain: CHAIN,
      count: sortedQueue.length,
      queue: sortedQueue,
    };
  } finally {
    // Always close the Redis connection so Node.js exits cleanly.
    // Without this the ioredis singleton keeps the event loop alive indefinitely.
    await redis.quit().catch(() => {});
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(`[surface_evaluator] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
