'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Trade Blueprint Engine  v1.0  (Execution Design Layer)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/trade_blueprint_engine.js
//  STATUS    : NEW — Boss ruling 2026-04-10 (Execution Design Phase)
//
//  PURPOSE
//  ─────────
//  Convert an EXECUTION_READY signal into a deterministic, replayable
//  TRADE BLUEPRINT — a fully-specified execution plan that can be audited,
//  replayed, and eventually handed to a transaction builder.
//
//  THIS MODULE DOES NOT:
//  ✗ Send transactions
//  ✗ Call ethers.Wallet or sign anything
//  ✗ Touch private keys
//  ✗ Interact with flash loan contracts
//  ✗ Make any RPC calls
//
//  THIS MODULE DOES:
//  ✓ Compute direction (buy/sell sides)
//  ✓ Compute token amounts from USD size + pool price
//  ✓ Compute slippage estimate from depth
//  ✓ Compute safety buffers (minOut)
//  ✓ Compute confidence score (deterministic, weighted)
//  ✓ Emit a fully-specified, JSON-serializable blueprint
//  ✓ Degrade gracefully when fields are absent
//
//  PIPELINE POSITION
//  ─────────────────
//  ACTIVATOR → EXECUTION_READY signal → [this module] → BLUEPRINT → LOGGER
//
//  Blueprints are stored in logs/trade_blueprints.jsonl for analysis and
//  eventual handoff to the execution simulation layer.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── PAIR REGISTRY ────────────────────────────────────────────────────────────
// Pool addresses and token metadata per activator pair string.
// Must match PAIR_CONFIGS in arb_window_activator.js exactly.
// CPT owns this registry — update here when activator adds a new pair.

const PAIR_REGISTRY = Object.freeze({
  'ARB/USDC': {
    baseToken:    'ARB',
    quoteToken:   'USDC',
    dec0: 18, dec1: 6,
    venues: {
      univ3:    { name: 'uniswap_v3',  pool: '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8', feePct: 0.0005 },
      camelot:  { name: 'camelot_v3',  pool: '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1', feePct: 0.000249 },
    },
  },
  'ETH/USDC': {
    baseToken:    'WETH',
    quoteToken:   'USDC',
    dec0: 18, dec1: 6,
    venues: {
      univ3:    { name: 'uniswap_v3',  pool: '0x6f38e884725a116C9C7fBF208e79FE8828a2595F', feePct: 0.0001 },
      camelot:  { name: 'camelot_v3',  pool: '0xB1026b8e7276e7AC75410F1fcbbe21796e8f7526', feePct: 0.0001 },
    },
  },
  'ETH/USDT': {
    baseToken:    'WETH',
    quoteToken:   'USDT',
    dec0: 18, dec1: 6,
    venues: {
      univ3:    { name: 'uniswap_v3',  pool: '0x42161084d0672e1d3F26a9B53E653bE2084ff19C', feePct: 0.0001 },
      camelot:  { name: 'camelot_v3',  pool: '0x7CcCBA38E2D959fe135e79AEBB57CCb27B128358', feePct: 0.0001 },
    },
  },
  'ETH/USDC-RAMSES': {
    baseToken:    'WETH',
    quoteToken:   'USDC',
    dec0: 18, dec1: 6,
    venues: {
      univ3:    { name: 'uniswap_v3',  pool: '0x6f38e884725a116C9C7fBF208e79FE8828a2595F', feePct: 0.0001 },
      camelot:  { name: 'ramses_v2',   pool: '0x30AFBcF9458c3131A6d051C621E307E6278E4110', feePct: 0.0005 },
    },
  },
});

// ─── CONFIDENCE WEIGHTS ───────────────────────────────────────────────────────
// Boss-specified weighted confidence model.
// Keep centralized — do not inline.

const CONFIDENCE_WEIGHTS = Object.freeze({
  spreadStrength  : 0.35,   // how far above the viable floor
  depthQuality    : 0.30,   // depth vs execution floor ($15k)
  profileQuality  : 0.20,   // SAFE > BALANCED > AGGRESSIVE (precision ordering)
  premiumBonus    : 0.15,   // bonus for ≥ 0.18% premium zone
});

// Reference values for normalization
const SPREAD_FLOOR_PCT    = 0.13;   // min viable spread %
const SPREAD_PREMIUM_PCT  = 0.18;   // premium zone threshold %
const SPREAD_SCALE_PCT    = 0.30;   // 0.30% spread = full spread score
const DEPTH_FLOOR_USD     = 15_000; // execution depth floor
const DEPTH_SCALE_USD     = 200_000; // $200k depth = full depth score

// Profile quality scores (BALANCED is precision sweet spot per v6 data)
const PROFILE_SCORES = Object.freeze({
  BALANCED   : 1.00,
  SAFE       : 0.80,
  AGGRESSIVE : 0.60,
});

// Slippage model v1: linear approximation
// slippage % = (sizeUsd / (2 * depthUsd)) * 100
// Matches the formula used in the activator's slippagePct() function.
const SLIPPAGE_BUFFER_MULT = 1.5;   // apply 1.5× safety margin on estimated slippage

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function clamp01(x) { return Math.max(0, Math.min(1, isFinite(x) ? x : 0)); }
function r6(x)      { return isFinite(x) ? +x.toFixed(6) : null; }
function r4(x)      { return isFinite(x) ? +x.toFixed(4) : null; }
function r2(x)      { return isFinite(x) ? +x.toFixed(2) : null; }
function nowIso()   { return new Date().toISOString(); }

let _blueprintSeq = 0;
function nextBlueprintId() {
  _blueprintSeq++;
  const seq  = String(_blueprintSeq).padStart(6, '0');
  const ts   = Date.now().toString(36).toUpperCase();
  return `BP-${ts}-${seq}`;
}

// ─── DIRECTION RESOLVER ───────────────────────────────────────────────────────

/**
 * Determine trade direction: which venue is cheaper (buy side) and which
 * is more expensive (sell side).
 *
 * Convention: price = quote per base (e.g. USDC per ETH).
 *   Lower price venue  → BUY base here (spend USDC, receive ETH)
 *   Higher price venue → SELL base here (spend ETH, receive USDC)
 *
 * @param {number} uniPrice   UniV3 pool price (quoteToken per baseToken)
 * @param {number} camPrice   Pool B price
 * @param {object} pairMeta   PAIR_REGISTRY entry
 * @returns {{ direction, buyVenue, sellVenue, buyPrice, sellPrice }}
 */
function resolveDirection(uniPrice, camPrice, pairMeta) {
  const { venues, baseToken, quoteToken } = pairMeta;
  const buyOnUni = uniPrice <= camPrice;

  const buyVenue  = buyOnUni ? venues.univ3  : venues.camelot;
  const sellVenue = buyOnUni ? venues.camelot : venues.univ3;
  const buyPrice  = buyOnUni ? uniPrice  : camPrice;
  const sellPrice = buyOnUni ? camPrice  : uniPrice;

  const dirLabel = buyOnUni
    ? `BUY_${venues.univ3.name.toUpperCase()}_SELL_${venues.camelot.name.toUpperCase()}`
    : `BUY_${venues.camelot.name.toUpperCase()}_SELL_${venues.univ3.name.toUpperCase()}`;

  return {
    direction  : dirLabel,
    buyVenue,
    sellVenue,
    buyPrice,
    sellPrice,
    baseToken,
    quoteToken,
  };
}

// ─── TOKEN MATH ───────────────────────────────────────────────────────────────

/**
 * Compute token amounts from a USD trade size.
 *
 * Simple v1 model (no multi-hop, no tick-level simulation):
 *   tokenInAmount  = sizeUsd / buyPrice   (spend quoteToken to buy baseToken)
 *   tokenOutExpected = sizeUsd / sellPrice * (1 - sellFee)
 *
 * Both amounts are in human-readable units (not wei).
 *
 * @param {number} sizeUsd
 * @param {number} buyPrice   quoteToken per baseToken at buy venue
 * @param {number} sellPrice  quoteToken per baseToken at sell venue
 * @param {number} buyFeePct  fractional fee (e.g. 0.0001 for 0.01%)
 * @param {number} sellFeePct
 * @returns {{ tokenInAmount, tokenInSymbol, tokenOutExpected, tokenOutSymbol,
 *             baseTokenAmount, grossOutputUsd }}
 */
function computeTokenAmounts(sizeUsd, buyPrice, sellPrice, buyFeePct, sellFeePct, baseToken, quoteToken) {
  if (!sizeUsd || !buyPrice || !sellPrice || buyPrice <= 0 || sellPrice <= 0) {
    return { tokenInAmount: null, tokenInSymbol: quoteToken, tokenOutExpected: null,
             tokenOutSymbol: quoteToken, baseTokenAmount: null, grossOutputUsd: null };
  }

  // Step 1: spend quoteToken → receive baseToken at buy venue
  const baseTokenAmount   = sizeUsd / buyPrice;               // e.g. ETH received
  const buyFeeDeducted    = baseTokenAmount * (1 - buyFeePct); // after buy fee

  // Step 2: sell baseToken → receive quoteToken at sell venue
  const grossOutputUsd    = buyFeeDeducted * sellPrice;
  const tokenOutExpected  = grossOutputUsd * (1 - sellFeePct);

  return {
    tokenInAmount    : r6(sizeUsd),
    tokenInSymbol    : quoteToken,
    baseTokenAmount  : r6(buyFeeDeducted),
    baseTokenSymbol  : baseToken,
    tokenOutExpected : r6(tokenOutExpected),
    tokenOutSymbol   : quoteToken,
    grossOutputUsd   : r6(grossOutputUsd),
  };
}

// ─── SLIPPAGE MODEL ───────────────────────────────────────────────────────────

/**
 * v1 linear slippage estimate.
 * slippagePct = (sizeUsd / (2 × depthUsd)) × 100
 * Returns fraction (0.01 = 1%) for use in minOut calculation.
 *
 * @param {number} sizeUsd
 * @param {number} depthUsd  Active-tick depth of the thin leg
 * @returns {number}  slippage fraction
 */
function estimateSlippageFrac(sizeUsd, depthUsd) {
  if (!depthUsd || depthUsd <= 0) return 0.005; // conservative 0.5% default
  return (sizeUsd / (2 * depthUsd));
}

// ─── SAFETY BUFFERS ───────────────────────────────────────────────────────────

/**
 * Compute minOut — minimum acceptable output after slippage × buffer.
 * minOut = expectedOut × (1 − slippageFrac × SLIPPAGE_BUFFER_MULT)
 *
 * @param {number} expectedOut   tokenOutExpected (human units)
 * @param {number} slippageFrac  estimated slippage as fraction
 * @returns {number}
 */
function computeMinOut(expectedOut, slippageFrac) {
  if (!expectedOut || expectedOut <= 0) return null;
  const buffer = Math.min(slippageFrac * SLIPPAGE_BUFFER_MULT, 0.05); // cap buffer at 5%
  return r6(expectedOut * (1 - buffer));
}

// ─── CONFIDENCE SCORE ─────────────────────────────────────────────────────────

/**
 * Deterministic confidence score ∈ [0, 1].
 *
 * Components:
 *   spreadStrength  — how far above the viable floor (0.13%) the spread is
 *   depthQuality    — thin-leg depth vs execution floor ($15k)
 *   profileQuality  — BALANCED > SAFE > AGGRESSIVE
 *   premiumBonus    — 1.0 if spread ≥ 0.18%, else 0
 *
 * @param {number} spreadPct    Gross spread in % (e.g. 0.172)
 * @param {number} depthUsd     Thin-leg active-tick depth in USD
 * @param {string} profile      'SAFE'|'BALANCED'|'AGGRESSIVE'
 * @returns {number}  confidenceScore [0,1]
 */
function computeConfidenceScore(spreadPct, depthUsd, profile) {
  // Spread strength: normalized above viable floor
  const spreadAboveFloor   = Math.max(0, spreadPct - SPREAD_FLOOR_PCT);
  const spreadStrengthRaw  = spreadAboveFloor / (SPREAD_SCALE_PCT - SPREAD_FLOOR_PCT);
  const spreadStrength     = clamp01(spreadStrengthRaw);

  // Depth quality: normalized vs execution floor
  const depthRatio   = (depthUsd || 0) / DEPTH_SCALE_USD;
  const depthQuality = clamp01(depthRatio);

  // Profile quality
  const profileQuality = PROFILE_SCORES[profile] ?? PROFILE_SCORES.SAFE;

  // Premium bonus: 1 if in premium zone, 0 otherwise
  const premiumBonus = spreadPct >= SPREAD_PREMIUM_PCT ? 1.0 : 0.0;

  const score =
    CONFIDENCE_WEIGHTS.spreadStrength  * spreadStrength  +
    CONFIDENCE_WEIGHTS.depthQuality    * depthQuality    +
    CONFIDENCE_WEIGHTS.profileQuality  * profileQuality  +
    CONFIDENCE_WEIGHTS.premiumBonus    * premiumBonus;

  return +(clamp01(score)).toFixed(4);
}

// ─── PRIMARY ENTRY POINT ──────────────────────────────────────────────────────

/**
 * Build a deterministic trade blueprint from an EXECUTION_READY signal.
 *
 * The signal shape comes from arb_window_activator.js emitSignal() plus
 * the extra envelope fields added by appendLog().
 *
 * Degrades gracefully: if required fields are missing, blueprint is still
 * emitted with nulls and a `_degraded: true` flag — never throws.
 *
 * @param {object} signal  EXECUTION_READY record from activator log
 * @param {object} [pairCfgOverride]  Optional: pass activator's pairCfg directly
 *                                    to avoid re-lookup by pair string
 * @returns {object}  Trade blueprint (JSON-serializable)
 */
function buildTradeBlueprint(signal, pairCfgOverride) {
  try {
    return _buildBlueprint(signal, pairCfgOverride);
  } catch (err) {
    // Per-signal fault isolation — never throw to caller
    return {
      blueprintId     : nextBlueprintId(),
      ts              : nowIso(),
      signalTs        : signal?.ts ?? null,
      pair            : signal?.pair ?? 'unknown',
      _degraded       : true,
      _error          : err.message,
    };
  }
}

function _buildBlueprint(signal, pairCfgOverride) {
  const pair     = signal.pair || 'ETH/USDC-RAMSES';
  const pairMeta = PAIR_REGISTRY[pair] ?? PAIR_REGISTRY['ETH/USDC-RAMSES'];

  // ── Core signal fields ───────────────────────────────────────────────────
  const uniPrice   = Number(signal.uniPrice);
  const camPrice   = Number(signal.camPrice);
  const uniDepth   = Number(signal.uniDepth);     // thin leg (UniV3)
  const spreadPct  = Number(signal.spread);
  const sizeUsd    = Number(signal.bestSize) || 200;
  const finalEdge  = Number(signal.finalEdge);
  const gasPriceGwei = Number(signal.gasPriceGwei);
  const gasUnits   = Number(signal.gasUnits) || 900_000;
  const ethPrice   = 2000; // embedded constant — not live, for gas cost calc only
  const gasUsd     = (gasUnits * gasPriceGwei * 1e-9 * ethPrice);
  const profile    = signal.activeProfile || 'SAFE';

  // ── Direction ─────────────────────────────────────────────────────────────
  const dir = resolveDirection(uniPrice, camPrice, pairMeta);

  // ── Token math ────────────────────────────────────────────────────────────
  const amounts = computeTokenAmounts(
    sizeUsd,
    dir.buyPrice,
    dir.sellPrice,
    dir.buyVenue.feePct,
    dir.sellVenue.feePct,
    dir.baseToken,
    dir.quoteToken
  );

  // ── Slippage ──────────────────────────────────────────────────────────────
  const slippageFrac   = estimateSlippageFrac(sizeUsd, uniDepth);
  const slippageBps    = +(slippageFrac * 10_000).toFixed(2);
  const minOutEntry    = computeMinOut(amounts.baseTokenAmount, slippageFrac);
  const minOutExit     = computeMinOut(amounts.tokenOutExpected, slippageFrac);
  const maxGasUsd      = r6(gasUsd * 2);  // 2× gas budget as max tolerance

  // ── Confidence ────────────────────────────────────────────────────────────
  const confidenceScore = computeConfidenceScore(spreadPct, uniDepth, profile);

  // ── Net profit ────────────────────────────────────────────────────────────
  const netProfitUsd = amounts.tokenOutExpected
    ? r2((amounts.tokenOutExpected - sizeUsd) - gasUsd)
    : null;

  // ── Viability flags ───────────────────────────────────────────────────────
  const spreadAboveFloor = spreadPct >= SPREAD_FLOOR_PCT;
  const premiumZone      = spreadPct >= SPREAD_PREMIUM_PCT;

  // ── Blueprint assembly ───────────────────────────────────────────────────
  return {
    blueprintId  : nextBlueprintId(),
    ts           : nowIso(),
    signalTs     : signal.ts,
    signalBlock  : signal.block ?? null,

    pair,
    direction    : dir.direction,

    venues: {
      entry: {
        venue         : dir.buyVenue.name,
        pool          : dir.buyVenue.pool,
        tokenIn       : dir.quoteToken,
        tokenOut      : dir.baseToken,
        expectedPrice : r6(dir.buyPrice),
        feePct        : dir.buyVenue.feePct,
      },
      exit: {
        venue         : dir.sellVenue.name,
        pool          : dir.sellVenue.pool,
        tokenIn       : dir.baseToken,
        tokenOut      : dir.quoteToken,
        expectedPrice : r6(dir.sellPrice),
        feePct        : dir.sellVenue.feePct,
      },
    },

    sizing: {
      targetUsd       : sizeUsd,
      tokenInAmount   : amounts.tokenInAmount,
      tokenInSymbol   : amounts.tokenInSymbol,
      baseTokenAmount : amounts.baseTokenAmount,
      baseTokenSymbol : amounts.baseTokenSymbol,
      tokenOutExpected: amounts.tokenOutExpected,
      tokenOutSymbol  : amounts.tokenOutSymbol,
    },

    executionPlan: {
      route  : [
        `${dir.buyVenue.name.toUpperCase()}_SWAP`,
        `${dir.sellVenue.name.toUpperCase()}_SWAP`,
      ],
      atomic : true,   // v1 assumption: single atomic multicall
      chain  : 'arbitrum',
    },

    economics: {
      spreadPct       : r4(spreadPct),
      expectedEdgePct : r6(finalEdge),
      gasCostUsd      : r6(gasUsd),
      gasPriceGwei    : r6(gasPriceGwei),
      gasUnits,
      netProfitUsd,
      feeBurden       : r6((dir.buyVenue.feePct + dir.sellVenue.feePct) * 100),
      slippageBps,
    },

    safety: {
      minOutEntry           : minOutEntry,
      minOutEntrySymbol     : dir.baseToken,
      minOutExit            : minOutExit,
      minOutExitSymbol      : dir.quoteToken,
      slippageToleranceBps  : slippageBps,
      maxGasUsd,
    },

    viability: {
      spreadAboveFloor,
      premiumZone,
      depthAboveExecFloor : uniDepth >= DEPTH_FLOOR_USD,
      economicStatus      : signal.economicStatus ?? null,
      confidenceScore,
    },

    // Activator context — for audit trail and correlation
    _context: {
      regime          : signal.regime ?? null,
      activeProfile   : profile,
      edgeBucket      : signal.edgeBucket ?? null,
      readinessClass  : signal.readinessClass ?? null,
      windowId        : signal.windowId ?? null,
      heatClass       : signal.heatClass ?? null,
      heatScore       : signal.heatScore ?? null,
    },
  };
}

// ─── MODULE EXPORTS ───────────────────────────────────────────────────────────

module.exports = {
  buildTradeBlueprint,

  // Exposed for testing and downstream callers
  resolveDirection,
  computeTokenAmounts,
  estimateSlippageFrac,
  computeMinOut,
  computeConfidenceScore,

  // Constants — read-only for report formatting
  PAIR_REGISTRY,
  CONFIDENCE_WEIGHTS,
  SPREAD_FLOOR_PCT,
  SPREAD_PREMIUM_PCT,
  DEPTH_FLOOR_USD,
};
