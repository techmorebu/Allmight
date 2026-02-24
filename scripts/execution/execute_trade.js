/**
 * scripts/execution/execute_trade.js
 *
 * Execution bridge -- called by shadow_mode.py when --live flag is set.
 * Reads opportunity from stdin as JSON, executes via ArbitrageBot.sol.
 *
 * Flow:
 *   shadow_mode.py detects spread
 *     -> writes opportunity JSON to stdin
 *       -> this script reads it
 *         -> pre-flight checks
 *           -> ArbitrageBot.executeArbitrage()
 *             -> waits for receipt
 *               -> writes result JSON to stdout
 *                 -> shadow_mode.py reads result
 *                   -> logs + Discord alert
 *
 * Called as:
 *   echo '{"pair":"ETH/USDT",...}' | node scripts/execution/execute_trade.js
 *
 * Environment (.env):
 *   ARBITRUM_MAINNET_RPC_URL_1   -- live RPC
 *   METAMASK_PRIVATE_KEY         -- wallet private key
 *   ARBITRAGE_BOT_ADDRESS        -- deployed contract address
 *   LIVE_TRADING_ENABLED         -- must be "true" to execute
 *   MAX_TRADE_SIZE_USD            -- hard cap per trade
 *   MIN_PROFIT_BPS               -- minimum edge to execute
 */

const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const readline   = require("readline");

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [k, ...v] = line.split("=");
    if (!process.env[k.trim()]) {
      process.env[k.trim()] = v.join("=").trim();
    }
  });
}
loadEnv();

// ── Contract ABI (minimal -- only what we need) ───────────────────────────────
const BOT_ABI = [
  "function executeArbitrage(address asset, uint256 amount, uint8 buyVenue, uint8 sellVenue) external",
  "function setMinProfitUsd(uint256 newMin) external",
  "function slippageBps() view returns (uint256)",
  "function minProfitUsd() view returns (uint256)",
  "function owner() view returns (address)",
  "event ArbitrageExecuted(address indexed asset, uint256 amount, uint256 profit, uint8 buyVenue, uint8 sellVenue)",
  "event ArbitrageFailed(string reason)",
];

// ── Token addresses (Arbitrum mainnet) ───────────────────────────────────────
const TOKENS = {
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

const VENUES = { uniswap_v3: 0, uniswap: 0, curve: 1 };

// ── Safety config ─────────────────────────────────────────────────────────────
const MAX_TRADE_USD   = parseFloat(process.env.MAX_TRADE_SIZE_USD  || "100");
const MIN_PROFIT_BPS  = parseFloat(process.env.MIN_PROFIT_BPS      || "10");
const GAS_LIMIT       = 500000n;
const MAX_GAS_GWEI    = 2.0;   // Arbitrum is cheap -- abort if > 2 gwei

// ── Result writer ─────────────────────────────────────────────────────────────
function result(success, data) {
  process.stdout.write(JSON.stringify({ success, ...data }) + "\n");
  process.exit(success ? 0 : 1);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── Read opportunity from stdin ─────────────────────────────────────────
  let opp;
  try {
    const rl   = readline.createInterface({ input: process.stdin });
    const line = await new Promise(r => rl.once("line", r));
    rl.close();
    opp = JSON.parse(line);
  } catch (e) {
    return result(false, { error: "Failed to parse opportunity JSON", detail: e.message });
  }

  const {
    session_id,
    pair        = "ETH/USDT",
    buy_venue   = "",
    sell_venue  = "",
    gross_bps   = 0,
    net_profit_usd = 0,
    trade_size_usd = MAX_TRADE_USD,
  } = opp;

  // ── Pre-flight safety checks ────────────────────────────────────────────
  const checks = [];

  // 1. Live trading must be explicitly enabled
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    return result(false, {
      error:      "LIVE_TRADING_ENABLED is not set to true",
      action:     "Set LIVE_TRADING_ENABLED=true in .env to enable live trading",
      session_id,
    });
  }

  // 2. Contract address required
  const botAddress = process.env.ARBITRAGE_BOT_ADDRESS;
  if (!botAddress || botAddress.includes("YOUR_") || botAddress === "") {
    return result(false, {
      error:      "ARBITRAGE_BOT_ADDRESS not set in .env",
      session_id,
    });
  }

  // 3. Private key required
  const privKey = process.env.METAMASK_PRIVATE_KEY;
  if (!privKey || privKey === "****" || privKey.includes("YOUR_")) {
    return result(false, {
      error:      "METAMASK_PRIVATE_KEY not set in .env",
      session_id,
    });
  }

  // 4. Minimum edge check
  if (gross_bps < MIN_PROFIT_BPS) {
    return result(false, {
      error:      `Edge ${gross_bps}bps below minimum ${MIN_PROFIT_BPS}bps`,
      skipped:    true,
      session_id,
    });
  }

  // 5. Trade size cap
  const size = Math.min(trade_size_usd, MAX_TRADE_USD);
  if (size <= 0) {
    return result(false, { error: "Trade size must be > 0", session_id });
  }

  // 6. Venue mapping
  const buyVenueIdx  = VENUES[buy_venue.toLowerCase()];
  const sellVenueIdx = VENUES[sell_venue.toLowerCase()];
  if (buyVenueIdx === undefined || sellVenueIdx === undefined) {
    return result(false, {
      error:   `Unknown venue: ${buy_venue} / ${sell_venue}`,
      session_id,
    });
  }
  if (buyVenueIdx === sellVenueIdx) {
    return result(false, { error: "Buy and sell venue must differ", session_id });
  }

  // ── Connect to Arbitrum ─────────────────────────────────────────────────
  const rpcUrl = process.env.ARBITRUM_MAINNET_RPC_URL_1;
  if (!rpcUrl || rpcUrl.includes("YOUR_")) {
    return result(false, { error: "ARBITRUM_MAINNET_RPC_URL_1 not set", session_id });
  }

  let provider, wallet, bot;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    wallet   = new ethers.Wallet(privKey, provider);
    bot      = new ethers.Contract(botAddress, BOT_ABI, wallet);
  } catch (e) {
    return result(false, { error: "Connection failed", detail: e.message, session_id });
  }

  // ── Gas check ───────────────────────────────────────────────────────────
  let gasPrice;
  try {
    const feeData = await provider.getFeeData();
    gasPrice      = feeData.gasPrice;
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, "gwei"));
    if (gasPriceGwei > MAX_GAS_GWEI) {
      return result(false, {
        error:       `Gas too high: ${gasPriceGwei.toFixed(3)} gwei (max ${MAX_GAS_GWEI})`,
        gas_gwei:    gasPriceGwei,
        session_id,
      });
    }
    checks.push(`gas: ${gasPriceGwei.toFixed(3)} gwei ✅`);
  } catch (e) {
    return result(false, { error: "Gas price check failed", detail: e.message, session_id });
  }

  // ── Wallet balance check ────────────────────────────────────────────────
  try {
    const bal     = await provider.getBalance(wallet.address);
    const balEth  = parseFloat(ethers.formatEther(bal));
    if (balEth < 0.001) {
      return result(false, {
        error:   `Insufficient ETH for gas: ${balEth.toFixed(6)} ETH`,
        balance: balEth,
        session_id,
      });
    }
    checks.push(`balance: ${balEth.toFixed(6)} ETH ✅`);
  } catch (e) {
    return result(false, { error: "Balance check failed", detail: e.message, session_id });
  }

  // ── Determine asset and amount ──────────────────────────────────────────
  const useWeth  = pair.startsWith("ETH") || pair.startsWith("WETH");
  const asset    = useWeth ? TOKENS.WETH : TOKENS.USDT;
  const decimals = useWeth ? 18n : 6n;
  const amountBn = ethers.parseUnits(size.toString(), decimals);

  checks.push(`asset: ${useWeth ? "WETH" : "USDT"} ✅`);
  checks.push(`amount: $${size} ✅`);
  checks.push(`route: ${buy_venue}(${buyVenueIdx})->${sell_venue}(${sellVenueIdx}) ✅`);

  // ── Execute ─────────────────────────────────────────────────────────────
  let tx, receipt;
  const t0 = Date.now();

  try {
    tx = await bot.executeArbitrage(
      asset,
      amountBn,
      buyVenueIdx,
      sellVenueIdx,
      { gasLimit: GAS_LIMIT }
    );

    checks.push(`tx submitted: ${tx.hash} ✅`);

    receipt = await tx.wait(1);  // wait 1 confirmation
  } catch (e) {
    const msg = e.message || "";

    // On-chain revert -- profitability gate caught it -- zero loss
    if (msg.includes("revert") || msg.includes("not profitable") ||
        msg.includes("execution reverted")) {
      return result(false, {
        error:      "On-chain revert -- profitability gate protected",
        reverted:   true,
        zero_loss:  true,
        detail:     msg.slice(0, 200),
        checks,
        session_id,
        pair,
        gross_bps,
      });
    }

    return result(false, {
      error:      "Transaction failed",
      detail:     msg.slice(0, 200),
      checks,
      session_id,
    });
  }

  const elapsed_ms = Date.now() - t0;

  // ── Parse ArbitrageExecuted event ──────────────────────────────────────
  let actual_profit_wei = 0n;
  let actual_profit_usd = 0;
  try {
    const iface = new ethers.Interface(BOT_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "ArbitrageExecuted") {
          actual_profit_wei = parsed.args.profit;
          // USDT is 6 decimals, WETH is 18 -- use rough USD conversion
          actual_profit_usd = useWeth
            ? parseFloat(ethers.formatEther(actual_profit_wei)) * 2700  // rough ETH price
            : parseFloat(ethers.formatUnits(actual_profit_wei, 6));
          break;
        }
      } catch {}
    }
  } catch {}

  const gas_used     = receipt.gasUsed;
  const gas_cost_eth = parseFloat(ethers.formatEther(gas_used * gasPrice));

  return result(true, {
    session_id,
    pair,
    buy_venue,
    sell_venue,
    gross_bps,
    simulated_profit_usd: net_profit_usd,
    actual_profit_usd:    parseFloat(actual_profit_usd.toFixed(6)),
    actual_profit_wei:    actual_profit_wei.toString(),
    tx_hash:              tx.hash,
    block:                receipt.blockNumber,
    gas_used:             gas_used.toString(),
    gas_cost_eth:         gas_cost_eth.toFixed(6),
    elapsed_ms,
    trade_size_usd:       size,
    checks,
  });
}

main().catch(e => {
  result(false, { error: "Unexpected error", detail: e.message });
});
