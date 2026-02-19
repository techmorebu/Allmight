# PHASE 2.4.2 — ROUTE SIMULATOR SPEC

**Status:** DRAFT → IMPLEMENT  
**Phase:** 2.4.2  
**Governance:** Deterministic simulation, no RPC calls, state-bounded

---

## 0. Purpose

Route Simulator is the **deterministic execution model** that computes what would happen if we execute a specific route at a specific block state.

**Must be pure and deterministic:**
- Same pool state + same swap → same output
- No network I/O during simulation
- All state inputs explicit (block_ref)
- Reproducible results

---

## 1. Architecture

### 1.1 Layered Design

**Layer 1: Core Interfaces** (types.py, base.py)
- Define canonical types (RouteLeg, Route, SimContext, SimResult)
- Abstract simulator interface

**Layer 2A: V2 Simulator** (v2_simulator.py)
- Constant product formula (Uniswap V2, Sushiswap)
- Simple, fast, accurate

**Layer 2B: V3 Simulator** (v3_simulator.py)
- Tick-based math (Uniswap V3)
- Concentrated liquidity
- More complex, higher precision

**Layer 3: Route Composer** (route_composer.py)
- Multi-hop routes
- Combine legs (V2 → V3 → V2)

---

## 2. Core Types

### 2.1 RouteLeg
```python
@dataclass
class RouteLeg:
    """Single swap step in a route"""
    venue_id: str          # "uniswap_v3", "sushiswap"
    pool_id: str           # Pool address
    token_in: str          # Input token address
    token_out: str         # Output token address
    amount_in: int         # Amount in (wei)
    fee_tier: Optional[int] # Fee tier (bps) - V3: 500/3000/10000
    dex_type: str          # "v2" or "v3"
```

### 2.2 Route
```python
@dataclass
class Route:
    """Multi-leg route"""
    legs: List[RouteLeg]
    chain_id: str
    route_id: str  # Stable identifier
```

### 2.3 SimContext
```python
@dataclass
class SimContext:
    """Simulation context (deterministic inputs)"""
    block_ref: int
    chain_id: str
    gas_model: GasModelV1  # Bounded gas estimation
    slippage_tolerance_bps: float = 50.0  # Max acceptable slippage
```

### 2.4 SimResult
```python
@dataclass
class SimResult:
    """Simulation outcome"""
    ok: bool
    gross_profit_wei: int
    net_profit_wei: int
    gas_used_est_wei: int
    price_impact_bps: float
    effective_price: float
    
    # Risk flags
    revert_risk: bool
    slippage_exceeded: bool
    
    # Failure info
    failure_code: Optional[str]
    failure_detail: Optional[str]
```

---

## 3. V2 Simulator (Constant Product)

### 3.1 Pool State Input
```python
@dataclass
class V2PoolState:
    """V2 pool state at block_ref"""
    reserve0: int  # Reserve of token0 (wei)
    reserve1: int  # Reserve of token1 (wei)
    token0: str    # Token0 address
    token1: str    # Token1 address
    fee_bps: int   # Swap fee (30 bps typical)
```

### 3.2 Swap Formula
```python
def compute_v2_swap_out(
    amount_in: int,
    reserve_in: int,
    reserve_out: int,
    fee_bps: int
) -> int:
    """
    Uniswap V2 constant product formula
    
    x * y = k (constant)
    amount_out = (amount_in * (1 - fee) * reserve_out) / 
                 (reserve_in + amount_in * (1 - fee))
    """
    amount_in_with_fee = amount_in * (10000 - fee_bps)
    numerator = amount_in_with_fee * reserve_out
    denominator = (reserve_in * 10000) + amount_in_with_fee
    
    amount_out = numerator // denominator
    return amount_out
```

### 3.3 Price Impact
```python
def compute_price_impact(
    amount_in: int,
    amount_out: int,
    reserve_in: int,
    reserve_out: int
) -> float:
    """
    Compute price impact in bps
    
    spot_price = reserve_out / reserve_in
    effective_price = amount_out / amount_in
    impact = (1 - effective_price / spot_price) * 10000
    """
    spot_price = reserve_out / reserve_in
    effective_price = amount_out / amount_in
    impact_bps = (1 - effective_price / spot_price) * 10000
    return impact_bps
```

---

## 4. V3 Simulator (Tick-Based)

### 4.1 Pool State Input
```python
@dataclass
class V3PoolState:
    """V3 pool state at block_ref"""
    sqrt_price_x96: int  # Current price (sqrtPriceX96)
    tick: int            # Current tick
    liquidity: int       # Active liquidity
    fee_tier: int        # Fee tier (500/3000/10000 bps)
    token0: str
    token1: str
    
    # Optional: tick data for exact simulation
    tick_data: Optional[Dict[int, int]] = None  # {tick: liquidityNet}
```

### 4.2 Simplified V3 (Phase 2.4.2A)
```python
def compute_v3_swap_out_simplified(
    amount_in: int,
    sqrt_price_x96: int,
    liquidity: int,
    fee_tier: int,
    zero_for_one: bool
) -> Tuple[int, int]:
    """
    Simplified V3 swap (QuoterV2-style)
    
    Assumes sufficient liquidity in current tick range.
    Returns: (amount_out, new_sqrt_price_x96)
    """
    # This is a placeholder - actual implementation requires
    # tick math from Uniswap V3 core library
    pass
```

### 4.3 Exact V3 (Phase 2.4.2B - Later)
- Walk ticks
- Track liquidity changes
- Handle tick crossings
- More complex, higher precision

---

## 5. Deterministic Failure Codes

```python
class SimFailureCode:
    """Canonical simulation failure codes"""
    INSUFFICIENT_LIQUIDITY = "SIM_INSUFFICIENT_LIQUIDITY"
    PRICE_IMPACT_TOO_HIGH = "SIM_PRICE_IMPACT_TOO_HIGH"
    SLIPPAGE_EXCEEDED = "SIM_SLIPPAGE_EXCEEDED"
    INVALID_POOL_STATE = "SIM_INVALID_POOL_STATE"
    RESERVES_DEPLETED = "SIM_RESERVES_DEPLETED"
    UNKNOWN_DEX_TYPE = "SIM_UNKNOWN_DEX_TYPE"
```

---

## 6. Integration Points

### 6.1 Input: Pool State at block_ref
- Must be fetched BEFORE simulation
- Cached per block_ref
- Never fetch during simulation

### 6.2 Output: SimResult
- Feeds into bundle simulator (Phase 2.4.3)
- Emits telemetry: ROUTE_SIM_RESULT

---

## 7. Tests Required

### 7.1 V2 Tests
- Single swap (known reserves)
- Price impact calculation
- Multi-hop composition
- Determinism (same state → same output)

### 7.2 V3 Tests
- Single swap (known sqrtPrice + liquidity)
- Price impact
- Determinism

### 7.3 Failure Tests
- Insufficient liquidity
- Excessive price impact
- Invalid pool state

---

## 8. File Layout

```
scripts/execution/route_simulator/
    __init__.py
    types.py              # Core types
    base.py               # Abstract interfaces
    v2_simulator.py       # V2 implementation
    v3_simulator.py       # V3 implementation (simplified)
    route_composer.py     # Multi-hop
    failure_codes.py      # Canonical codes

tests/execution/route_simulator/
    test_v2_determinism.py
    test_v2_price_impact.py
    test_v3_determinism.py
```

---

## 9. Phase 2.4.2 Milestones

### 2.4.2A (MVP - Start Here)
- ✅ Core types defined
- ✅ V2 simulator working
- ✅ Basic tests passing
- ✅ Single-hop routes

### 2.4.2B (Later)
- ✅ V3 simplified simulator
- ✅ Multi-hop composer
- ✅ Telemetry integration

### 2.4.2C (Future)
- ⏸ V3 exact tick-walk
- ⏸ Tick data caching
- ⏸ Advanced optimizations

---

## 10. Done Criteria

Phase 2.4.2A is complete when:
- V2 simulator produces correct outputs
- Determinism verified (same state → same output)
- Price impact calculation accurate
- Tests passing
- Ready for preflight → simulator integration

---

**Next:** Start with types.py and v2_simulator.py

**Status:** Ready to implement  
**Date:** 2026-02-19
