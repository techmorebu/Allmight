// scripts/tools/build_token_registry_from_pools.js
// One-time builder to derive per-chain token registries from pool contracts.
// Fix: ethers v6 may return BigInt for uint/int values; JSON.stringify can't serialize BigInt.
// We normalize decimals to Number (or null) and also use a BigInt-safe JSON replacer.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const UNI_V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const CHAINS = {
  ethereum: { rpcEnv: "ETHEREUM_RPC_URL" },
  arbitrum: { rpcEnv: "ARBITRUM_RPC_URL" },
  optimism: { rpcEnv: "OPTIMISM_RPC_URL" },
  base: { rpcEnv: "BASE_RPC_URL" },
};

const POOLS_FILE = path.join(process.cwd(), "config", "pools", "pools_by_chain.json");
const OUT_DIR = path.join(process.cwd(), "config", "tokens");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function jsonReplacer(_k, v) {
  // Convert BigInt to string so JSON.stringify doesn't explode.
  // (We also normalize decimals to Number below, but this is a safety net.)
  return typeof v === "bigint" ? v.toString() : v;
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, jsonReplacer, 2) + "\n");
}

function normAddr(a) {
  return ethers.getAddress(a);
}

async function safeSymbol(token) {
  try { return await token.symbol(); } catch {}
  try { return await token.name(); } catch {}
  return null;
}

function normalizeDecimals(d) {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return d;
  if (typeof d === "bigint") return Number(d); // uint8 safe
  // ethers sometimes returns BigNumber-like, but v6 uses bigint.
  // Fall back to Number() if it's stringable.
  try { return Number(d); } catch { return null; }
}

async function main() {
  if (!fs.existsSync(POOLS_FILE)) {
    console.error("Missing config/pools/pools_by_chain.json");
    process.exit(2);
  }

  const poolsByChain = readJson(POOLS_FILE);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [chain, cfg] of Object.entries(CHAINS)) {
    const rpcUrl = process.env[cfg.rpcEnv];
    const pools = poolsByChain[chain] || [];

    if (!pools.length) {
      console.log(`[${chain}] pools: 0 (skip)`);
      continue;
    }

    if (!rpcUrl) {
      console.error(`Missing env ${cfg.rpcEnv} (needed for ${chain})`);
      process.exit(2);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log(`[${chain}] pools: ${pools.length}`);

    const registry = {};
    const seen = new Map();

    for (const p of pools) {
      const poolAddr = normAddr(p.address);
      const pool = new ethers.Contract(poolAddr, UNI_V3_POOL_ABI, provider);

      let t0, t1;
      try {
        [t0, t1] = await Promise.all([pool.token0(), pool.token1()]);
      } catch (e) {
        console.warn(`[${chain}] skip pool ${poolAddr} (token0/token1 failed)`);
        continue;
      }

      for (const addrRaw of [t0, t1]) {
        const addr = normAddr(addrRaw);
        if (!seen.has(addr)) {
          const token = new ethers.Contract(addr, ERC20_ABI, provider);
          let decimals = null;
          let symbol = null;

          try { decimals = normalizeDecimals(await token.decimals()); } catch {}
          try { symbol = await safeSymbol(token); } catch {}

          seen.set(addr, { symbol, decimals });
        }
      }
    }

    for (const [addr, meta] of seen.entries()) {
      const key = meta.symbol && !registry[meta.symbol] ? meta.symbol : addr;
      registry[key] = {
        address: addr,
        decimals: meta.decimals, // Number or null
        symbol: meta.symbol
      };
    }

    const outPath = path.join(OUT_DIR, `${chain}.json`);
    writeJson(outPath, registry);
    console.log(`[${chain}] wrote ${outPath} (${Object.keys(registry).length} entries)`);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
