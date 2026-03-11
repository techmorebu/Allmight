'use strict';

const { ethers } = require("ethers");

/*
Provider Factory
----------------

Supports BOTH interfaces:

NEW:
    const rpc = createProvider("ethereum")

OLD (legacy fetchers):
    const rpc = makeFailoverProvider("ethereum")

Both resolve to the same implementation.
*/

function sanitizeRpcUrl(raw) {
  if (!raw) return null;

  const url = String(raw).trim();

  try {
    const u = new URL(url);

    // Block unsafe Ankr endpoint
    if (u.hostname === "rpc.ankr.com" && u.pathname === "/eth") {
      console.warn("[RPC] Dropping unsafe Ankr endpoint:", url);
      return null;
    }

    return u.toString();

  } catch {
    return null;
  }
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);

    if (segs.length > 1) {
      segs[1] = "REDACTED";
    }

    u.pathname = "/" + segs.join("/");
    return u.toString();
  } catch {
    return "INVALID_URL";
  }
}

function getChainRpcUrls(chainKey) {

  const key = `${chainKey.toUpperCase()}_RPC_URLS`;

  const raw = process.env[key] || "";

  return raw
    .split(",")
    .map(x => sanitizeRpcUrl(x))
    .filter(Boolean);
}

function createProvider(chainKey) {

  const urls = getChainRpcUrls(chainKey);

  if (!urls.length) {
    throw new Error(`No RPC URLs configured for ${chainKey}`);
  }

  const providers = urls.map(url =>
    new ethers.JsonRpcProvider(
      url,
      undefined,
      {
        batchMaxCount: 1,
        batchStallTime: 0
      }
    )
  );

  let index = 0;

  function rotate() {
    index = (index + 1) % providers.length;
  }

  function provider() {
    return providers[index];
  }

  async function call(label, fn, attempts = 4) {

    let lastErr;

    for (let i = 0; i < attempts; i++) {

      try {
        const p = provider();
        return await fn(p);

      } catch (err) {

        lastErr = err;

        console.warn(`[RPC] fail ${label} → rotating endpoint`);

        rotate();

        await new Promise(r => setTimeout(r, 150 * (i + 1)));
      }
    }

    throw lastErr;
  }

  console.log(JSON.stringify({
    ev: "rpc_init",
    chain: chainKey.toUpperCase(),
    endpoints: urls.map((u,i)=>({
      endpointId: i,
      url: redactUrl(u)
    }))
  }));

  return {
    call,
    provider,
    urls
  };
}

/*
Legacy compatibility layer
--------------------------
Some fetchers still call makeFailoverProvider().
We alias it to the new system.
*/

function makeFailoverProvider(chainKey) {
  return createProvider(chainKey);
}

module.exports = {

  createProvider,

  makeFailoverProvider,

  getChainRpcUrls

};
