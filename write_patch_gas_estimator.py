#!/usr/bin/env python3
"""
Patch: fixes estimate_gas_cost_usd() in scripts/run_reality_check.py
to read the correct gas oracle field structure.

Real structure:
  payload["data"]["data"]["thresholds"]["flashLoanSimple"]["fast"]["gasCostUSD"]
  payload["data"]["data"]["consensus"]["fast"]  (gwei)
  payload["data"]["data"]["networkState"]["recommendation"]

Run from project root: python3 write_patch_gas_estimator.py
"""
import os

TARGET = os.path.expanduser("~/Allmight/scripts/run_reality_check.py")

OLD = '''def estimate_gas_cost_usd(redis_client) -> float:
    """
    Pull gas price from gasPriceOracle Redis key.
    Falls back to a conservative default if unavailable.
    Assumes ~300k gas for a two-hop flash arb on mainnet.
    """
    GAS_UNITS = 300_000
    FALLBACK_GWEI = 30.0
    ETH_PRICE_FALLBACK = 1800.0

    try:
        raw = redis_client.get("fetcher:gasPriceOracle")
        if raw:
            payload = json.loads(raw)
            # Try to get fast gas price
            gwei = (
                payload.get("data", {})
                       .get("data", {})
                       .get("fast")
                or payload.get("data", {}).get("fast")
                or FALLBACK_GWEI
            )
            gwei = float(gwei) if gwei else FALLBACK_GWEI
        else:
            gwei = FALLBACK_GWEI
            logger.warning("Gas oracle not in Redis, using fallback %s gwei", FALLBACK_GWEI)
    except Exception as e:
        gwei = FALLBACK_GWEI
        logger.warning("Gas oracle parse failed (%s), using fallback", e)

    eth_price = ETH_PRICE_FALLBACK
    try:
        # Try to infer ETH price from Uniswap data already in Redis
        raw_uni = redis_client.get("fetcher:uniswapV3Fetcher")
        if raw_uni:
            uni = json.loads(raw_uni)
            prices = (
                uni.get("data", {}).get("data", {}).get("prices")
                or uni.get("data", {}).get("prices")
                or []
            )
            for p in prices:
                if p.get("pair", "").upper() in ("ETH/USDC", "USDC/ETH"):
                    eth_price = float(p.get("price", ETH_PRICE_FALLBACK))
                    break
    except Exception:
        pass

    gas_eth = (gwei * 1e-9) * GAS_UNITS
    gas_usd = gas_eth * eth_price
    return round(gas_usd, 4)'''

NEW = '''def estimate_gas_cost_usd(redis_client, speed: str = "fast") -> float:
    """
    Pull gas cost from gasPriceOracle Redis key.

    Real oracle structure:
      data.data.thresholds.flashLoanSimple.{speed}.gasCostUSD  <- use this
      data.data.consensus.{speed}                               <- gwei fallback
      data.data.networkState.recommendation                     <- suggested speed

    Falls back to gwei calculation if threshold table unavailable.
    speed: "slow" | "standard" | "fast" | "instant"
    """
    FALLBACK_USD = 2.0   # conservative fallback if oracle unavailable
    ETH_PRICE_FALLBACK = 1950.0
    GAS_UNITS_FLASH_SIMPLE = 200_000

    try:
        raw = redis_client.get("fetcher:gasPriceOracle")
        if not raw:
            logger.warning("Gas oracle not in Redis, using fallback $%.2f", FALLBACK_USD)
            return FALLBACK_USD

        payload = json.loads(raw)
        data = payload.get("data", {}).get("data", {})

        # Prefer the oracle's own pre-computed threshold table
        threshold_usd = (
            data.get("thresholds", {})
                .get("flashLoanSimple", {})
                .get(speed, {})
                .get("gasCostUSD")
        )
        if threshold_usd is not None and float(threshold_usd) > 0:
            gas_usd = float(threshold_usd)
            logger.info(f"Gas estimate (oracle threshold, {speed}): ${gas_usd:.4f}")
            return gas_usd

        # Fallback: compute from consensus gwei + ETH price
        gwei = data.get("consensus", {}).get(speed) or data.get("consensus", {}).get("fast")
        if gwei is None:
            logger.warning("Gas consensus missing, using fallback")
            return FALLBACK_USD

        gwei = float(gwei)

        # Get ETH price from Uniswap data
        eth_price = ETH_PRICE_FALLBACK
        try:
            raw_uni = redis_client.get("fetcher:uniswapV3Fetcher")
            if raw_uni:
                uni = json.loads(raw_uni)
                for p in uni.get("data", {}).get("data", {}).get("prices", []):
                    if p.get("pair", "").upper() == "ETH/USDC":
                        eth_price = float(p.get("price", ETH_PRICE_FALLBACK))
                        break
        except Exception:
            pass

        gas_eth = (gwei * 1e-9) * GAS_UNITS_FLASH_SIMPLE
        gas_usd = gas_eth * eth_price
        logger.info(f"Gas estimate (computed, {speed}, {gwei:.4f} gwei): ${gas_usd:.6f}")
        return round(gas_usd, 6)

    except Exception as e:
        logger.warning("Gas estimate failed (%s), using fallback $%.2f", e, FALLBACK_USD)
        return FALLBACK_USD'''

with open(TARGET, "r") as f:
    content = f.read()

if OLD not in content:
    print("❌ Could not find target function — may already be patched or file differs.")
    print("   Search for: 'def estimate_gas_cost_usd' and verify manually.")
else:
    content = content.replace(OLD, NEW, 1)
    with open(TARGET, "w") as f:
        f.write(content)
    print(f"✅ Patched {TARGET}")
    print("   Gas estimator now reads oracle threshold table directly.")
    print("   flashLoanSimple/fast cost will be used (~$1.23 at current prices).")
