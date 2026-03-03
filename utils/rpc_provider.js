/**
 * utils/rpc_provider.js
 *
 * Goal: stop RPC vendors from wrecking fetchers via batching + rate limits.
 * - Disables JSON-RPC batching (ethers v6 JsonRpcProvider batchMaxCount=1).
 * - Supports URL failover/rotation via ENV: <PREFIX>_RPC_URLS (comma-separated).
 * - Light retry/backoff on common rate limit patterns.
 *
 * Example:
 *   ETHEREUM_RPC_URLS="https://mainnet.infura.io/v3/KEY,https://eth.llamarpc.com,https://rpc.ankr.com/eth"
 */
const { ethers } = require("ethers");

function _splitUrls(s) {
  return (s || "")
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getRpcUrls(prefix) {
  const urls = _splitUrls(process.env[`${prefix}_RPC_URLS`]);
  const single = (process.env[`${prefix}_RPC_URL`] || "").trim();
  if (urls.length) return urls;
  if (single) return [single];
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const code = err?.code;
  // ethers BAD_DATA often wraps vendor codes (-32005) in the payload/value
  const val = String(err?.value || "");
  return (
    code === "SERVER_ERROR" ||
    code === "BAD_DATA" ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    val.includes("-32005") ||
    val.toLowerCase().includes("too many requests")
  );
}

function makeNoBatchProvider(url, options = {}) {
  // ethers v6: JsonRpcProvider(url, network, { batchMaxCount, batchStallTime })
  // Setting batchMaxCount=1 effectively disables batching.
  const batchMaxCount = options.batchMaxCount ?? 1;
  const batchStallTime = options.batchStallTime ?? 0;
  return new ethers.JsonRpcProvider(url, undefined, { batchMaxCount, batchStallTime });
}

function makeFailoverProvider(prefix, options = {}) {
  const urls = getRpcUrls(prefix);
  if (!urls.length) {
    throw new Error(`No RPC URL configured for ${prefix}. Set ${prefix}_RPC_URL or ${prefix}_RPC_URLS.`);
  }
  let idx = 0;

  function currentUrl() {
    return urls[idx % urls.length];
  }

  function rotate() {
    idx = (idx + 1) % urls.length;
  }

  function provider() {
    return makeNoBatchProvider(currentUrl(), options);
  }

  async function withRetry(fn, { attempts = 5, baseDelayMs = 250, maxDelayMs = 3000 } = {}) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      const p = provider();
      try {
        return await fn(p, currentUrl());
      } catch (e) {
        lastErr = e;
        if (!isRateLimitError(e) || urls.length === 1) {
          // Not a rate limit pattern or no alternatives
          // Still backoff a tiny bit to reduce hammering.
          await sleep(Math.min(maxDelayMs, baseDelayMs * (2 ** i)));
        } else {
          rotate();
          const jitter = Math.floor(Math.random() * 150);
          const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** i) + jitter);
          await sleep(delay);
        }
      }
    }
    throw lastErr;
  }

  return {
    urls,
    provider,
    withRetry,
  };
}

module.exports = {
  getRpcUrls,
  makeNoBatchProvider,
  makeFailoverProvider,
};
