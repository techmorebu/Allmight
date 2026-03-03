/**
 * utils/rpc_provider.js
 *
 * Hardened RPC provider system
 *
 * Features:
 * - disables JSON-RPC batching (ethers v6)
 * - RPC URL sanitation (blocks bare Ankr endpoints)
 * - multi-endpoint failover
 * - rate limit backoff
 * - authentication error detection
 * - endpoint mapping telemetry (rpc_init)
 */

const { ethers } = require("ethers");

/* ------------------------------------------------ */
/* URL SANITIZATION                                 */
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

  // Block unauthenticated Ankr Ethereum endpoint
  if (host === "rpc.ankr.com" && path === "/eth") {
    console.warn("[RPC] Dropping unauthenticated Ankr endpoint:", s);
    return null;
  }

  return u.toString();
}

function _splitUrls(s) {
  return (s || "")
    .split(/[,\s]+/g)
    .map((x) => sanitizeRpcUrl(x))
    .filter(Boolean);
}

/* ------------------------------------------------ */
/* ENV LOADING                                      */
/* ------------------------------------------------ */

function getRpcUrls(prefix) {
  const urls = _splitUrls(process.env[`${prefix}_RPC_URLS`]);
  const single = sanitizeRpcUrl(process.env[`${prefix}_RPC_URL`] || "");

  if (urls.length) return urls;
  if (single) return [single];

  return [];
}

/* ------------------------------------------------ */
/* UTILS                                            */
/* ------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactUrl(url) {
  try {
    const u = new URL(url);

    const parts = u.pathname.split("/").filter(Boolean);
    const kept = parts.slice(0, 2).join("/");

    u.pathname = "/" + kept + (parts.length > 2 ? "/REDACTED" : "");
    u.search = "";
    u.hash = "";

    return u.toString();
  } catch {
    return "INVALID_URL";
  }
}

/* ------------------------------------------------ */
/* ERROR DETECTION                                  */
/* ------------------------------------------------ */

function isRateLimitError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const code = err?.code;
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

function isAuthError(err) {
  const msg = String(err?.message || "").toLowerCase();

  return (
    msg.includes("must authenticate") ||
    msg.includes("unauthorized") ||
    msg.includes("invalid api key")
  );
}

/* ------------------------------------------------ */
/* PROVIDER CREATION                                */
/* ------------------------------------------------ */

function makeNoBatchProvider(url, options = {}) {
  const batchMaxCount = options.batchMaxCount ?? 1;
  const batchStallTime = options.batchStallTime ?? 0;

  return new ethers.JsonRpcProvider(
    url,
    undefined,
    { batchMaxCount, batchStallTime }
  );
}

/* ------------------------------------------------ */
/* FAILOVER PROVIDER                                */
/* ------------------------------------------------ */

function makeFailoverProvider(prefix, options = {}) {
  const urls = getRpcUrls(prefix);

  if (!urls.length) {
    throw new Error(
      `No RPC URL configured for ${prefix}. Set ${prefix}_RPC_URL or ${prefix}_RPC_URLS`
    );
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

  /* ---------- telemetry ---------- */

  console.log(
    JSON.stringify({
      ev: "rpc_init",
      chain: prefix,
      endpoints: urls.map((u, i) => ({
        endpointId: i,
        url: redactUrl(u)
      }))
    })
  );

  /* ---------- retry wrapper ---------- */

  async function withRetry(
    fn,
    { attempts = 5, baseDelayMs = 250, maxDelayMs = 3000 } = {}
  ) {
    let lastErr = null;

    for (let i = 0; i < attempts; i++) {
      const p = provider();

      try {
        return await fn(p, currentUrl());
      } catch (e) {
        lastErr = e;

        /* authentication failures */
        if (isAuthError(e)) {
          console.warn("[RPC] Authentication failure. Rotating endpoint:", currentUrl());
          rotate();
          continue;
        }

        /* rate limit failures */
        if (isRateLimitError(e) && urls.length > 1) {
          rotate();

          const jitter = Math.floor(Math.random() * 150);
          const delay = Math.min(
            maxDelayMs,
            baseDelayMs * (2 ** i) + jitter
          );

          await sleep(delay);
          continue;
        }

        /* other failures */
        await sleep(Math.min(maxDelayMs, baseDelayMs * (2 ** i)));
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
/* EXPORTS                                          */
/* ------------------------------------------------ */

module.exports = {
  getRpcUrls,
  makeNoBatchProvider,
  makeFailoverProvider
};
