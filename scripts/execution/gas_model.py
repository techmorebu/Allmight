#!/usr/bin/env python3
"""
Gas Model - Phase 2.4.1

Bounded, deterministic gas cost estimation.
No RPC calls - uses conservative static estimates.

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

from typing import Dict, Tuple


class GasModelV1:
    """
    Deterministic gas cost estimator
    
    Returns bounded estimates based on:
    - Chain (Ethereum vs L2s)
    - Venue (DEX type)
    - Tier (trade size)
    
    All values conservative (overestimate cost).
    """
    
    # Gas units by venue type (conservative estimates)
    GAS_UNITS = {
        'uniswap_v3': 180_000,
        'uniswap_v2': 120_000,
        'sushiswap': 120_000,
        'curve': 200_000,
        'balancer': 250_000,
        'default': 150_000,
    }
    
    # Gas price by chain (gwei, conservative)
    GAS_PRICE_GWEI = {
        'eth': 30.0,        # Ethereum mainnet
        'arbitrum': 0.1,    # Arbitrum
        'optimism': 0.1,    # Optimism
        'polygon': 100.0,   # Polygon
        'base': 0.1,        # Base
        'default': 20.0,
    }
    
    # ETH price (USD, conservative for cost estimation)
    ETH_PRICE_USD = {
        'eth': 2500.0,
        'arbitrum': 2500.0,
        'optimism': 2500.0,
        'polygon': 0.8,  # MATIC price
        'base': 2500.0,
        'default': 2500.0,
    }
    
    def estimate_gas_units(self, venue_id: str) -> int:
        """
        Estimate gas units for a swap on this venue
        
        Returns:
            Gas units (conservative)
        """
        # Check for exact match
        if venue_id in self.GAS_UNITS:
            return self.GAS_UNITS[venue_id]
        
        # Check for partial match
        for key in self.GAS_UNITS:
            if key in venue_id.lower():
                return self.GAS_UNITS[key]
        
        # Default
        return self.GAS_UNITS['default']
    
    def estimate_gas_price_gwei(self, chain_id: str) -> float:
        """
        Estimate gas price for this chain
        
        Returns:
            Gas price in gwei (conservative)
        """
        return self.GAS_PRICE_GWEI.get(chain_id, self.GAS_PRICE_GWEI['default'])
    
    def estimate_eth_price_usd(self, chain_id: str) -> float:
        """
        Estimate ETH/native token price for this chain
        
        Returns:
            Price in USD (conservative)
        """
        return self.ETH_PRICE_USD.get(chain_id, self.ETH_PRICE_USD['default'])
    
    def estimate_usd(
        self, 
        chain_id: str, 
        venue_id: str, 
        tier_usd: int
    ) -> float:
        """
        Estimate total gas cost in USD
        
        Args:
            chain_id: Chain identifier
            venue_id: Venue identifier
            tier_usd: Trade size in USD
        
        Returns:
            Gas cost in USD (conservative estimate)
        """
        gas_units = self.estimate_gas_units(venue_id)
        gas_price_gwei = self.estimate_gas_price_gwei(chain_id)
        eth_price_usd = self.estimate_eth_price_usd(chain_id)
        
        # Convert to USD
        gas_cost_eth = (gas_units * gas_price_gwei) / 1e9  # gwei to ETH
        gas_cost_usd = gas_cost_eth * eth_price_usd
        
        return gas_cost_usd
    
    def estimate_bps(
        self,
        chain_id: str,
        venue_id: str,
        tier_usd: int
    ) -> float:
        """
        Estimate gas cost as basis points of trade size
        
        Args:
            chain_id: Chain identifier
            venue_id: Venue identifier
            tier_usd: Trade size in USD
        
        Returns:
            Gas cost in basis points
        """
        gas_cost_usd = self.estimate_usd(chain_id, venue_id, tier_usd)
        
        if tier_usd <= 0:
            return 0.0
        
        gas_bps = (gas_cost_usd / tier_usd) * 10000
        return gas_bps


# === DEFAULT GAS MODEL ===

DEFAULT_GAS_MODEL = GasModelV1()
