'use strict';

const { ethers } = require('ethers');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 2, baseDelayMs = 250, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await sleep(delay);
    }
  }
  const msg = lastErr && lastErr.message ? lastErr.message : String(lastErr);
  const err = new Error(`${label} failed after ${retries + 1} attempts: ${msg}`);
  err.cause = lastErr;
  throw err;
}

async function withTimeout(promise, ms, label = 'op') {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

function buildProviderFromEnv({ chain = 'ethereum' } = {}) {
  // Prefer the new canonical var names, but accept legacy ones.
  const env = process.env;
  const candidates = [];

  if (chain === 'ethereum') {
    candidates.push(env.ETHEREUM_RPC_URL, env.ETH_RPC_URL, env.ETHEREUM_MAINNET_RPC_URL_1, env.ETHEREUM_MAINNET_RPC_URL_2);
  } else if (chain === 'arbitrum') {
    candidates.push(env.ARBITRUM_RPC_URL, env.ARB_RPC_URL, env.ARBITRUM_MAINNET_RPC_URL_1, env.ARBITRUM_MAINNET_RPC_URL_2);
  } else if (chain === 'optimism') {
    candidates.push(env.OPTIMISM_RPC_URL, env.OP_RPC_URL, env.OPTIMISM_MAINNET_RPC_URL, env.OPTIMISM_MAINNET_RPC_URL_1);
  } else if (chain === 'base') {
    candidates.push(env.BASE_RPC_URL, env.BASE_MAINNET_RPC_URL_1);
  }

  const url = candidates.find((u) => typeof u === 'string' && u.trim().length > 0) || 'https://eth.llamarpc.com';
  return new ethers.JsonRpcProvider(url);
}

module.exports = { sleep, withRetry, withTimeout, buildProviderFromEnv };
