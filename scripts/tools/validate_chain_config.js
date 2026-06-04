#!/usr/bin/env node
'use strict';
// ============================================================================
// AllMight — Chain Config Validator
// PLACEMENT: scripts/tools/validate_chain_config.js
// STATUS:    Commit 1 of Wave 4 (cross-chain framework foundation)
//
// PURPOSE
//   Validate config/chains.json and per-chain config/tokens/<chain>.json
//   files. Run before any discovery / probe tool that reads chain config.
//
// USAGE
//   node scripts/tools/validate_chain_config.js              (real validation)
//   node scripts/tools/validate_chain_config.js --self-test  (deps-free assertions)
//
// EXIT CODES
//   0  validation passed (warnings are non-blocking)
//   1  validation FAILED (one or more errors)
//   2  config file(s) missing or unreadable
// ============================================================================

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const CHAINS_FILE = path.join(REPO, 'config', 'chains.json');

const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.includes('--self-test');

// ─── pure validators (testable, no I/O) ─────────────────────────────────────

function isHexAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

const VALID_VENUE_TYPES = ['uniswap_v3', 'algebra', 'aerodrome_v2', 'slipstream', 'ramses_v3'];

function validateTokenEntry(name, t) {
  const errors = [];
  if (typeof t !== 'object' || t === null) {
    errors.push(`token ${name}: not an object`);
    return errors;
  }
  if (!isHexAddress(t.address)) {
    errors.push(`token ${name}: address invalid (got ${JSON.stringify(t.address)})`);
  }
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 30) {
    errors.push(`token ${name}: decimals invalid (got ${t.decimals})`);
  }
  if (typeof t.symbol !== 'string' || !t.symbol.length) {
    errors.push(`token ${name}: symbol missing or invalid`);
  }
  return errors;
}

function validateVenueEntry(chainName, venueName, v) {
  const errors = [];
  const warnings = [];
  if (typeof v !== 'object' || v === null) {
    errors.push(`venue ${chainName}.${venueName}: not an object`);
    return { errors, warnings };
  }
  if (v.factory !== null && !isHexAddress(v.factory)) {
    errors.push(`venue ${chainName}.${venueName}: factory invalid (got ${JSON.stringify(v.factory)})`);
  }
  if (v.factory === null && !v.factoryEnv && !v.note) {
    warnings.push(`venue ${chainName}.${venueName}: factory is null with no factoryEnv or note — discovery will skip this venue silently`);
  }
  if (!VALID_VENUE_TYPES.includes(v.type)) {
    errors.push(`venue ${chainName}.${venueName}: type must be one of [${VALID_VENUE_TYPES.join(', ')}] (got ${JSON.stringify(v.type)})`);
  }
  if (!Array.isArray(v.feeTiers)) {
    errors.push(`venue ${chainName}.${venueName}: feeTiers must be an array (got ${typeof v.feeTiers})`);
  }
  return { errors, warnings };
}

function validateChainEntry(chainName, c, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  if (typeof c !== 'object' || c === null) {
    errors.push(`chain ${chainName}: not an object`);
    return { errors, warnings };
  }
  if (!isPositiveInt(c.chainId)) {
    errors.push(`chain ${chainName}: chainId must be positive integer (got ${c.chainId})`);
  }
  if (typeof c.rpcEnv !== 'string') {
    errors.push(`chain ${chainName}: rpcEnv must be string (got ${typeof c.rpcEnv})`);
  } else if (!opts.skipEnvCheck && !process.env[c.rpcEnv]) {
    warnings.push(`chain ${chainName}: rpcEnv ${c.rpcEnv} not set in environment (will fail at runtime; ok for static validation)`);
  }
  if (typeof c.tokensFile !== 'string') {
    errors.push(`chain ${chainName}: tokensFile must be string`);
  }
  if (typeof c.venues !== 'object' || c.venues === null) {
    errors.push(`chain ${chainName}: venues must be object`);
  } else {
    for (const [vn, v] of Object.entries(c.venues)) {
      const r = validateVenueEntry(chainName, vn, v);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
  }
  return { errors, warnings };
}

// ─── EIP-55 checksum (lazy ethers; only in main, not self-test) ─────────────

function checksumWarnings(chainsConfig, tokenFiles) {
  const warnings = [];
  let ethers;
  try {
    ethers = require('ethers');
  } catch (e) {
    warnings.push('(ethers not available — skipping EIP-55 checksum validation; addresses still lex-validated by isHexAddress)');
    return warnings;
  }
  const tryCheck = (addr, where) => {
    if (addr === null) return;
    try {
      const canonical = ethers.getAddress(addr);
      if (canonical !== addr) {
        warnings.push(`${where}: not EIP-55 checksummed — canonical form is ${canonical}`);
      }
    } catch (e) {
      // ethers rejected — try lowercase recovery to give a usable hint
      try {
        const canonical = ethers.getAddress(addr.toLowerCase());
        warnings.push(`${where}: invalid checksum — try ${canonical}`);
      } catch (_) {
        warnings.push(`${where}: ethers.getAddress() rejected (${e.message})`);
      }
    }
  };
  for (const [cn, c] of Object.entries(chainsConfig.chains || {})) {
    for (const [vn, v] of Object.entries(c.venues || {})) {
      if (v.factory) tryCheck(v.factory, `chains.${cn}.venues.${vn}.factory`);
    }
  }
  for (const [cn, tf] of Object.entries(tokenFiles)) {
    for (const [tn, t] of Object.entries(tf.tokens || {})) {
      tryCheck(t.address, `tokens.${cn}.${tn}.address`);
    }
  }
  return warnings;
}

// ─── self-test (deps-free) ──────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0, total = 0;
  const a = (name, cond) => {
    total++;
    if (cond) passed++;
    else console.error(`  FAIL: ${name}`);
  };

  // isHexAddress
  a('isHexAddress: valid checksummed', isHexAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'));
  a('isHexAddress: lowercase valid', isHexAddress('0x420dd381b31aef6683db6b902084cb0ffece40da'));
  a('isHexAddress: missing 0x', !isHexAddress('1F98431c8aD98523631AE4a59f267346ea31F984'));
  a('isHexAddress: wrong length', !isHexAddress('0x1F98'));
  a('isHexAddress: non-string', !isHexAddress(null));
  a('isHexAddress: non-hex char', !isHexAddress('0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'));

  // isPositiveInt
  a('isPositiveInt: 42161', isPositiveInt(42161));
  a('isPositiveInt: 8453', isPositiveInt(8453));
  a('isPositiveInt: zero rejected', !isPositiveInt(0));
  a('isPositiveInt: negative rejected', !isPositiveInt(-1));
  a('isPositiveInt: float rejected', !isPositiveInt(8453.5));
  a('isPositiveInt: string rejected', !isPositiveInt('42161'));

  // validateTokenEntry
  a('token: valid WETH', validateTokenEntry('WETH', {
    symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18
  }).length === 0);
  a('token: bad address', validateTokenEntry('X', {
    symbol: 'X', address: 'not-an-address', decimals: 18
  }).length > 0);
  a('token: decimals too high', validateTokenEntry('X', {
    symbol: 'X', address: '0x4200000000000000000000000000000000000006', decimals: 99
  }).length > 0);
  a('token: missing symbol', validateTokenEntry('X', {
    address: '0x4200000000000000000000000000000000000006', decimals: 18
  }).length > 0);

  // validateVenueEntry
  const okV = validateVenueEntry('arbitrum', 'uniswap_v3', {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    type: 'uniswap_v3', feeTiers: [100, 500, 3000, 10000]
  });
  a('venue: valid uniswap_v3', okV.errors.length === 0);

  const nullF = validateVenueEntry('base', 'sushiswap_v3', {
    factory: null, type: 'uniswap_v3', feeTiers: [500], note: 'TODO verify'
  });
  a('venue: null factory with note ok (no warning)', nullF.errors.length === 0 && nullF.warnings.length === 0);

  const nullNoNote = validateVenueEntry('base', 'x', {
    factory: null, type: 'uniswap_v3', feeTiers: [500]
  });
  a('venue: null factory without note → warning', nullNoNote.errors.length === 0 && nullNoNote.warnings.length > 0);

  const badType = validateVenueEntry('x', 'y', {
    factory: null, type: 'wrong', feeTiers: [], note: 'x'
  });
  a('venue: bad type', badType.errors.length > 0);

  const badFee = validateVenueEntry('x', 'y', {
    factory: null, type: 'uniswap_v3', feeTiers: 'not-array', note: 'x'
  });
  a('venue: feeTiers not array', badFee.errors.length > 0);

  // validateChainEntry
  const okC = validateChainEntry('arbitrum', {
    chainId: 42161,
    rpcEnv: 'ARBITRUM_RPC_URL',
    tokensFile: 'config/tokens/arbitrum.json',
    venues: { uniswap_v3: {
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      type: 'uniswap_v3', feeTiers: [500]
    } }
  }, { skipEnvCheck: true });
  a('chain: valid arbitrum', okC.errors.length === 0);

  const badChainId = validateChainEntry('x', {
    chainId: -1, rpcEnv: 'X', tokensFile: 'x.json', venues: {}
  }, { skipEnvCheck: true });
  a('chain: bad chainId', badChainId.errors.length > 0);

  const missingVenues = validateChainEntry('x', {
    chainId: 1, rpcEnv: 'X', tokensFile: 'x.json'
  }, { skipEnvCheck: true });
  a('chain: missing venues', missingVenues.errors.length > 0);

  console.log(`  ${passed}/${total} assertions passed`);
  process.exit(passed === total ? 0 : 1);
}

// ─── main (real file validation) ────────────────────────────────────────────

function main() {
  if (SELF_TEST) return runSelfTest();

  console.log(`[validate_chain_config] reading ${path.relative(REPO, CHAINS_FILE)}`);

  if (!fs.existsSync(CHAINS_FILE)) {
    console.error(`MISSING: ${CHAINS_FILE}`);
    process.exit(2);
  }

  let chainsConfig;
  try {
    chainsConfig = JSON.parse(fs.readFileSync(CHAINS_FILE, 'utf-8'));
  } catch (e) {
    console.error(`PARSE ERROR (chains.json): ${e.message}`);
    process.exit(2);
  }

  if (!chainsConfig.chains || typeof chainsConfig.chains !== 'object') {
    console.error('chains.json: missing "chains" object at top level');
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  const tokenFiles = {};

  for (const [cn, c] of Object.entries(chainsConfig.chains)) {
    const r = validateChainEntry(cn, c);
    errors.push(...r.errors);
    warnings.push(...r.warnings);

    if (c.tokensFile) {
      const tokenPath = path.join(REPO, c.tokensFile);
      if (!fs.existsSync(tokenPath)) {
        errors.push(`tokens file MISSING for chain ${cn}: ${c.tokensFile}`);
        continue;
      }
      let tokenFile;
      try {
        tokenFile = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        tokenFiles[cn] = tokenFile;
      } catch (e) {
        errors.push(`tokens file parse error (${c.tokensFile}): ${e.message}`);
        continue;
      }
      if (tokenFile.chain !== cn) {
        errors.push(`tokens file ${c.tokensFile}: chain field "${tokenFile.chain}" ≠ expected "${cn}"`);
      }
      if (tokenFile.chainId !== c.chainId) {
        errors.push(`tokens file ${c.tokensFile}: chainId ${tokenFile.chainId} ≠ chains.json chainId ${c.chainId}`);
      }
      for (const [tn, t] of Object.entries(tokenFile.tokens || {})) {
        const te = validateTokenEntry(tn, t);
        errors.push(...te.map(e => `[${cn}] ${e}`));
      }
    }
  }

  warnings.push(...checksumWarnings(chainsConfig, tokenFiles));

  // Print structured summary
  console.log(`\n── Chains validated: ${Object.keys(chainsConfig.chains).join(', ')} ──`);
  for (const cn of Object.keys(chainsConfig.chains)) {
    const c = chainsConfig.chains[cn];
    const allVenues = Object.entries(c.venues || {});
    const enabled = allVenues.filter(([, v]) => v.factory !== null);
    const pending = allVenues.filter(([, v]) => v.factory === null);
    console.log(`  ${cn} (chainId ${c.chainId}):`);
    console.log(`    enabled venues: ${enabled.map(([n]) => n).join(', ') || '(none)'}`);
    if (pending.length) {
      console.log(`    pending venues: ${pending.map(([n]) => n).join(', ')}`);
    }
    if (tokenFiles[cn]) {
      console.log(`    tokens: ${Object.keys(tokenFiles[cn].tokens || {}).join(', ')}`);
    }
  }

  if (warnings.length) {
    console.log(`\n── WARNINGS (${warnings.length}) ──`);
    warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  }

  if (errors.length) {
    console.error(`\n── ERRORS (${errors.length}) ──`);
    errors.forEach(e => console.error(`  ❌  ${e}`));
    process.exit(1);
  }

  console.log(`\n✅ Validation passed (${warnings.length} warning${warnings.length === 1 ? '' : 's'}).`);
}

main();
