'use strict';

/*
  utils/provider_factory.js

  Unified RPC provider system.

  Goals
  -----
  - deterministic endpoint rotation
  - failover between multiple RPC URLs
  - JSON-RPC batching disabled
  - endpoint mapping telemetry
  - block unsafe endpoints (bare Ankr)
  - backwards compatibility with existing fetchers
*/

const { ethers } = require("ethers");

/* ------------------------------------------------ */
/* URL helpers                                      */
/* ------------------------------------------------ */

function sanitizeRpcUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  const host = (u.host || "").toLowerCase();
  const path = (u.pathname || "").replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);

  // Block bare Ankr endpoint (must include API key)
  if (host === "rpc.ankr.com" && segments.length === 1) {
    console.warn("[RPC] Dropping unsafe Ankr endpoint:", s);
    return null;
  }

  return u.toString();
}

function looksLikeKey(seg) {
  if (!seg) return false;
  if (seg.length >= 16) return true;
  if (/^[a-f0-9]{16,}$/i.test(seg)) return true;
  if (/^[a-z0-9_-]{20,}$/i.test(seg)) return true;
  return false;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);

    const out = [];

    if (segs[0]) out.push(segs[0]);

    if (segs[1]) {
      if (looksLikeKey(segs[1])) out.push("REDACTED");
      else out.push(segs[1]);
    }

    u.pathname = "/" + out.join("/");
    u.search = "";
    u.hash = "";

    return u.toString();
  } catch {
    return "INVALID_URL";
  }
}

/* ------------------------------------------------ */
/* RPC URL parsing                                  */
/* ------------------------------------------------ */

function getChainRpcUrls(chainKey) {
  const envKey = `${chainKey.toUpperCase()}_RPC_URLS`;

  const raw = process.env[envKey] || "";

  return raw
    .split(",")
    .map((x) => sanitizeRpcUrl(x))
    .filter(Boolean);
}

/* ------------------------------------------------ */
/* Provider creation                                */
/* ------------------------------------------------ */

function createProvider(chainKey, options = {}) {
  const urls = getChainRpcUrls(chainKey);

  if (!urls.length) {
    throw new Error(`No RPC URLs configured for ${chainKey}`);
  }

  const providers = urls.map((url) =>
    new ethers.JsonRpcProvider(
      url,
      undefined,
      {
        batchMaxCount: 1,
        batchStallTime: 0
      }
    )
  );

  let idx = 0;

  function rotate() {
    idx = (idx + 1) % providers.length;
  }

  function provider() {
    return providers[idx];
  }

  /* ---------- telemetry ---------- */

  console.log(
    JSON.stringify({
      ev: "rpc_init",
      chain: chainKey.toUpperCase(),
      endpoints: urls.map((u, i) => ({
        endpointId: i,
        url: redactUrl(u)
      }))
    })
  );

  /* ---------- retry wrapper ---------- */

  async function withRetry(
    fn,
    {
      attempts = 5,
      baseDelayMs = 250,
      maxDelayMs = 3000
    } = {}
  ) {
    let lastErr = null;

    for (let i = 0; i < attempts; i++) {
      const p = provider();

      try {
        return await fn(p, urls[idx]);
      } catch (e) {
        lastErr = e;

        const msg = String(e?.message || "").toLowerCase();

        const isAuth =
          msg.includes("unauthorized") ||
          msg.includes("authenticate") ||
          msg.includes("api key");

        if (isAuth) {
          console.warn("[RPC] Authentication failure, rotating endpoint:", urls[idx]);
          rotate();
          continue;
        }

        const jitter = Math.floor(Math.random() * 150);

        const delay = Math.min(
          maxDelayMs,
          baseDelayMs * (2 ** i) + jitter
        );

        await new Promise((r) => setTimeout(r, delay));

        rotate();
      }
    }

    throw lastErr;
  }

  return {
    urls,
    provider,
    withRetry
  };
}

/* ------------------------------------------------ */
/* Backwards compatibility                          */
/* ------------------------------------------------ */

module.exports = {
  createProvider,

  // old fetchers still expect this name
  makeFailoverProvider: createProvider,

  // fetchers inspect available URLs
  getChainRpcUrls
};
