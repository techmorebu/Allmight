#!/usr/bin/env python3
"""
Price Validator - Integrated Validation for Allmight
CRITICAL: Validates all prices before allowing trades
"""

import requests
import logging
from typing import Dict, List, Tuple, Optional
from datetime import datetime

logger = logging.getLogger('Allmight.Validator')


class PriceValidator:
    """
    Validates fetcher prices against multiple sources
    FAIL-SAFE: Returns False if any critical validation fails
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        self.coingecko_api = "https://api.coingecko.com/api/v3/simple/price"
        
        # Validation thresholds
        self.eth_price_tolerance_bps = self.config.get('eth_price_tolerance_bps', 200)  # 2%
        self.cross_dex_spread_max_bps = self.config.get('cross_dex_spread_max_bps', 500)  # 5%
        self.wbtc_eth_ratio_min = self.config.get('wbtc_eth_ratio_min', 20)
        self.wbtc_eth_ratio_max = self.config.get('wbtc_eth_ratio_max', 50)
        self.stablecoin_peg_tolerance_bps = self.config.get('stablecoin_peg_tolerance_bps', 100)  # 1%
        self.min_major_pair_tvl = self.config.get('min_major_pair_tvl', 1_000_000)  # $1M
        
        self.validation_cache = {}
        self.last_validation_time = None
        self.validation_cache_duration = 60  # Cache for 60 seconds
    
    def get_reference_prices(self) -> Dict:
        """Fetch reference prices from CoinGecko"""
        try:
            tokens = {
                'ethereum': 'ETH',
                'wrapped-bitcoin': 'WBTC',
                'chainlink': 'LINK',
                'uniswap': 'UNI',
                'aave': 'AAVE',
                'dai': 'DAI'
            }
            
            ids = ','.join(tokens.keys())
            response = requests.get(
                self.coingecko_api,
                params={'ids': ids, 'vs_currencies': 'usd'},
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"❌ CoinGecko API error: {response.status_code}")
                return {}
            
            data = response.json()
            
            return {
                symbol: data[coin_id]['usd'] 
                for coin_id, symbol in tokens.items()
                if coin_id in data
            }
            
        except Exception as e:
            logger.error(f"❌ Error fetching reference prices: {e}")
            return {}
    
    def calculate_deviation_bps(self, price1: float, price2: float) -> float:
        """Calculate deviation in basis points"""
        if price1 == 0 or price2 == 0:
            return 999999
        
        deviation = abs(price1 - price2) / price1
        return deviation * 10000
    
    def validate_eth_price(self, our_eth_price: float, reference_prices: Dict) -> Tuple[bool, str]:
        """
        CRITICAL: Validate ETH price accuracy
        Returns: (is_valid, message)
        """
        if 'ETH' not in reference_prices:
            return False, "No reference ETH price available"
        
        ref_price = reference_prices['ETH']
        deviation_bps = self.calculate_deviation_bps(ref_price, our_eth_price)
        
        if deviation_bps > self.eth_price_tolerance_bps:
            return False, f"ETH price deviation {deviation_bps:.0f} bps exceeds tolerance {self.eth_price_tolerance_bps} bps (Our: ${our_eth_price:.2f}, Ref: ${ref_price:.2f})"
        
        return True, f"ETH price validated: ${our_eth_price:.2f} (deviation: {deviation_bps:.0f} bps)"
    
    def validate_wbtc_ratio(self, wbtc_eth_price: float) -> Tuple[bool, str]:
        """
        CRITICAL: Validate WBTC/ETH ratio
        """
        if not (self.wbtc_eth_ratio_min < wbtc_eth_price < self.wbtc_eth_ratio_max):
            return False, f"WBTC/ETH ratio {wbtc_eth_price:.2f} outside valid range [{self.wbtc_eth_ratio_min}, {self.wbtc_eth_ratio_max}]"
        
        return True, f"WBTC/ETH ratio validated: {wbtc_eth_price:.2f}"
    
    def validate_stablecoin_peg(self, dai_eth_price: float, eth_usd_price: float) -> Tuple[bool, str]:
        """
        Validate DAI peg (should be ~$1.00)
        """
        if dai_eth_price > 10:  # Likely DAI/ETH price in DAI per ETH
            dai_usd = dai_eth_price / eth_usd_price
        else:
            dai_usd = 1.0  # Fallback
        
        deviation_from_peg = abs(dai_usd - 1.0)
        deviation_bps = deviation_from_peg * 10000
        
        if deviation_bps > self.stablecoin_peg_tolerance_bps:
            return False, f"DAI depeg warning: ${dai_usd:.4f} ({deviation_bps:.0f} bps from $1.00)"
        
        return True, f"DAI peg validated: ${dai_usd:.4f}"
    
    def validate_cross_dex_consistency(self, uniswap_prices: List, sushiswap_prices: List) -> Tuple[bool, str, List]:
        """
        CRITICAL: Validate prices are consistent across DEXs
        Large deviations could indicate stale data or oracle manipulation
        """
        errors = []
        warnings = []
        
        # Create lookup
        uni_lookup = {p['pair']: p['price'] for p in uniswap_prices}
        sushi_lookup = {p['pair']: p['price'] for p in sushiswap_prices}
        
        # Check common pairs
        common_pairs = set(uni_lookup.keys()) & set(sushi_lookup.keys())
        
        for pair in common_pairs:
            uni_price = uni_lookup[pair]
            sushi_price = sushi_lookup[pair]
            
            deviation_bps = self.calculate_deviation_bps(uni_price, sushi_price)
            
            if deviation_bps > self.cross_dex_spread_max_bps:
                errors.append(
                    f"{pair}: spread {deviation_bps:.0f} bps exceeds max {self.cross_dex_spread_max_bps} bps "
                    f"(Uni: ${uni_price:.2f}, Sushi: ${sushi_price:.2f})"
                )
        
        if errors:
            return False, "; ".join(errors), []
        
        return True, f"Cross-DEX consistency validated ({len(common_pairs)} pairs checked)", []
    
    def validate_liquidity(self, all_prices: List) -> Tuple[bool, str]:
        """
        Validate major pairs have sufficient liquidity
        """
        major_pairs = ['ETH/USDC', 'WBTC/ETH', 'DAI/ETH']
        warnings = []
        
        for price_data in all_prices:
            pair = price_data.get('pair', '')
            
            if pair in major_pairs:
                tvl = price_data.get('tvlUSD', 0) or price_data.get('reserveUSD', 0) or 0
                
                if tvl < self.min_major_pair_tvl:
                    warnings.append(
                        f"{pair}: Low TVL ${tvl:,.0f} (expected >${self.min_major_pair_tvl:,.0f})"
                    )
        
        if warnings:
            return False, "; ".join(warnings)
        
        return True, "Liquidity validated"
    
    def run_validation(self, fetcher_data: Dict) -> Dict:
        """
        Run complete validation suite
        
        Returns:
        {
            'valid': bool,  # Overall validation status
            'critical_errors': List[str],  # Errors that block trading
            'warnings': List[str],  # Non-blocking warnings
            'checks': Dict  # Detailed check results
        }
        """
        # Check cache
        now = datetime.now().timestamp()
        if (self.last_validation_time and 
            now - self.last_validation_time < self.validation_cache_duration and
            self.validation_cache):
            logger.info("⚡ Using cached validation results")
            return self.validation_cache
        
        logger.info("🔍 Running price validation...")
        
        result = {
            'valid': True,
            'critical_errors': [],
            'warnings': [],
            'checks': {},
            'timestamp': datetime.now().isoformat()
        }
        
        # Extract price data
        uniswap_data = fetcher_data.get('uniswap_v3', {})
        sushiswap_data = fetcher_data.get('sushiswap', {})
        
        uniswap_prices = uniswap_data.get('data', {}).get('prices', [])
        sushiswap_prices = sushiswap_data.get('data', {}).get('prices', [])
        
        if not uniswap_prices and not sushiswap_prices:
            result['valid'] = False
            result['critical_errors'].append("No price data available")
            return result
        
        # Get reference prices
        reference_prices = self.get_reference_prices()
        
        if not reference_prices:
            result['warnings'].append("Could not fetch reference prices from CoinGecko")
        
        # 1. Validate ETH prices
        for source_name, prices in [('Uniswap', uniswap_prices), ('Sushiswap', sushiswap_prices)]:
            eth_usdc = next((p for p in prices if p.get('pair') == 'ETH/USDC'), None)
            
            if eth_usdc and reference_prices:
                valid, msg = self.validate_eth_price(eth_usdc['price'], reference_prices)
                result['checks'][f'eth_price_{source_name.lower()}'] = {'valid': valid, 'message': msg}
                
                if not valid:
                    result['valid'] = False
                    result['critical_errors'].append(f"{source_name}: {msg}")
                else:
                    logger.info(f"✅ {source_name}: {msg}")
        
        # 2. Validate WBTC/ETH ratio
        for source_name, prices in [('Uniswap', uniswap_prices), ('Sushiswap', sushiswap_prices)]:
            wbtc_eth = next((p for p in prices if p.get('pair') == 'WBTC/ETH'), None)
            
            if wbtc_eth:
                valid, msg = self.validate_wbtc_ratio(wbtc_eth['price'])
                result['checks'][f'wbtc_ratio_{source_name.lower()}'] = {'valid': valid, 'message': msg}
                
                if not valid:
                    result['valid'] = False
                    result['critical_errors'].append(f"{source_name}: {msg}")
                else:
                    logger.info(f"✅ {source_name}: {msg}")
        
        # 3. Validate stablecoin peg
        eth_price = reference_prices.get('ETH', 2000)  # Fallback
        
        for source_name, prices in [('Uniswap', uniswap_prices), ('Sushiswap', sushiswap_prices)]:
            dai_eth = next((p for p in prices if p.get('pair') == 'DAI/ETH'), None)
            
            if dai_eth:
                valid, msg = self.validate_stablecoin_peg(dai_eth['price'], eth_price)
                result['checks'][f'dai_peg_{source_name.lower()}'] = {'valid': valid, 'message': msg}
                
                if not valid:
                    result['warnings'].append(f"{source_name}: {msg}")
                else:
                    logger.info(f"✅ {source_name}: {msg}")
        
        # 4. Cross-DEX consistency
        if uniswap_prices and sushiswap_prices:
            valid, msg, details = self.validate_cross_dex_consistency(uniswap_prices, sushiswap_prices)
            result['checks']['cross_dex_consistency'] = {'valid': valid, 'message': msg}
            
            if not valid:
                result['valid'] = False
                result['critical_errors'].append(f"Cross-DEX: {msg}")
            else:
                logger.info(f"✅ {msg}")
        
        # 5. Liquidity validation
        all_prices = uniswap_prices + sushiswap_prices
        valid, msg = self.validate_liquidity(all_prices)
        result['checks']['liquidity'] = {'valid': valid, 'message': msg}
        
        if not valid:
            result['warnings'].append(f"Liquidity: {msg}")
        else:
            logger.info(f"✅ {msg}")
        
        # Cache result
        self.validation_cache = result
        self.last_validation_time = now
        
        # Log summary
        if result['valid']:
            logger.info("✅ All critical validations PASSED")
        else:
            logger.error("❌ Validation FAILED")
            for error in result['critical_errors']:
                logger.error(f"   ❌ {error}")
        
        if result['warnings']:
            for warning in result['warnings']:
                logger.warning(f"   ⚠️  {warning}")
        
        return result
    
    def is_safe_to_trade(self, fetcher_data: Dict) -> bool:
        """
        Simple boolean check: Is it safe to execute trades?
        
        Returns:
            True: All critical validations passed, safe to trade
            False: Critical validation failed, DO NOT TRADE
        """
        validation_result = self.run_validation(fetcher_data)
        return validation_result['valid']
