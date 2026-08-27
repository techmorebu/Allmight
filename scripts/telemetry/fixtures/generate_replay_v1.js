#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1 — generate_replay_v1.js (fixture generator)
 *
 * Produces a deterministic fixture jsonl for c1 acceptance tests. Uses a
 * seeded RNG so byte-identical output on every invocation.
 *
 * OUTPUT records carry telemetrySource="FIXTURE" — never LIVE. If a
 * downstream consumer receives a FIXTURE record via the LIVE path,
 * that's a bug in the caller, not this fixture.
 *
 * Usage:
 *   node scripts/telemetry/fixtures/generate_replay_v1.js \
 *        --out <path> [--count N] [--seed N]
 *
 * Default: --count 20 --seed 1
 *
 * Determinism contract:
 *   sha256(output with default args) == baked constant checked by test
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const a = { out: null, count: 20, seed: 1 };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--out' && i + 1 < argv.length) a.out = argv[++i];
    else if (x === '--count' && i + 1 < argv.length) a.count = parseInt(argv[++i], 10);
    else if (x === '--seed' && i + 1 < argv.length) a.seed = parseInt(argv[++i], 10);
    else if (x === '--help' || x === '-h') { printHelp(); process.exit(0); }
    else { console.error('unknown arg:', x); process.exit(1); }
  }
  if (!a.out) { console.error('--out required'); process.exit(1); }
  return a;
}

function printHelp() {
  console.log(`Wave 11 c1 fixture generator
Usage: --out <path> [--count N=20] [--seed N=1]
Produces deterministic FIXTURE records (never LIVE).`);
}

// mulberry32 seeded RNG for determinism
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const startBlock = 200_000_000;
  const startTs = 1700000000; // fixed epoch for determinism

  const lines = [];
  for (let i = 0; i < args.count; i++) {
    // Wrap the SAME shape live_observer would emit, but with telemetrySource=FIXTURE
    const blockNumber = startBlock + i * 2;
    const timestamp = startTs + i * 4;
    const sqrtRamses = Math.floor(rng() * 1e18) + 1e18;
    const sqrtUniv3  = sqrtRamses + Math.floor((rng() - 0.5) * 1e15);

    const wrapped = {
      telemetrySource: 'FIXTURE',
      sourceProcess: 'generate_replay_v1',
      sourceSchemaVersion: 'fixture_v1',
      chain: 'arbitrum',
      sourcePath: 'FIXTURE:generate_replay_v1',
      sourceSha256AtOpen: 'FIXTURE',
      observerRunId: `FIXTURE_seed${args.seed}_i${i}`,
      observerSchemaVersion: '1',
      readAtUnixTime: startTs + i * 4,
      recordFromSource: {
        blockNumber,
        timestamp,
        uniswap_v3: { sqrtPriceX96: String(sqrtUniv3), liquidity: '1000000000000' },
        ramses_v2:  { sqrtPriceX96: String(sqrtRamses), liquidity: '1000000000000' },
        venue: 'ramses_v2'
      }
    };
    lines.push(JSON.stringify(wrapped));
  }

  const content = lines.join('\n') + '\n';
  fs.writeFileSync(args.out, content);
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  console.error(`fixture written: ${args.out}`);
  console.error(`records:         ${args.count}`);
  console.error(`sha256:          ${sha}`);
  console.log(sha); // stdout: sha only (for scripting)
}

main();
