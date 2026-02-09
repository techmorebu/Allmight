// scripts/data_collection/masterFetcher/gasPriceOracle.js
// Phase 1 - Gas Price Oracle
// Fetches current Ethereum gas prices from multiple sources
// Critical for flash loan profitability calculations

require('dotenv').config();
const fetch = require('node-fetch');

/**
 * Gas Price Oracle Fetcher
 * 
 * Fetches current gas prices from multiple sources:
 * 1. Infura Gas API (primary)
 * 2. Etherscan Gas Tracker (backup)
 * 3. EIP-1559 base fee from RPC (fallback)
 * 
 * Used to calculate if arbitrage is profitable after gas costs
 * 
 * @returns {Object} Current gas prices and profitability thresholds
 */
module.exports = async function gasPriceOracle() {
  const startTime = Date.now();
  
  const INFURA_API_KEY = process.env.ETHEREUM_MAINNET_RPC_URL_1?.split('/v3/')[1];
  const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
  const ETHEREUM_RPC = process.env.ETHEREUM_MAINNET_RPC_URL_1 || process.env.ETHEREUM_MAINNET_RPC_URL_2;
  
  try {
    const gasPrices = {
      infura: null,
      etherscan: null,
      rpc: null
    };
    
    const errors = [];
    
    // Source 1: Infura Gas API (most reliable for EIP-1559)
    if (INFURA_API_KEY) {
      try {
        const infuraResponse = await fetch(
          `https://gas.api.infura.io/v3/${INFURA_API_KEY}/networks/1/suggestedGasFees`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }
        );
        
        if (infuraResponse.ok) {
          const data = await infuraResponse.json();
          
          gasPrices.infura = {
            low: {
              maxPriorityFeePerGas: parseFloat(data.low.suggestedMaxPriorityFeePerGas),
              maxFeePerGas: parseFloat(data.low.suggestedMaxFeePerGas)
            },
            medium: {
              maxPriorityFeePerGas: parseFloat(data.medium.suggestedMaxPriorityFeePerGas),
              maxFeePerGas: parseFloat(data.medium.suggestedMaxFeePerGas)
            },
            high: {
              maxPriorityFeePerGas: parseFloat(data.high.suggestedMaxPriorityFeePerGas),
              maxFeePerGas: parseFloat(data.high.suggestedMaxFeePerGas)
            },
            estimatedBaseFee: parseFloat(data.estimatedBaseFee),
            networkCongestion: data.networkCongestion || 0,
            priorityFeePercentile: data.priorityFeePercentile || null
          };
        }
      } catch (err) {
        errors.push({ source: 'infura', error: err.message });
      }
    }
    
    // Source 2: Etherscan Gas Tracker (backup)
    if (ETHERSCAN_API_KEY) {
      try {
        const etherscanResponse = await fetch(
          `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`
        );
        
        if (etherscanResponse.ok) {
          const data = await etherscanResponse.json();
          
          if (data.status === '1' && data.result) {
            gasPrices.etherscan = {
              safe: parseFloat(data.result.SafeGasPrice),
              propose: parseFloat(data.result.ProposeGasPrice),
              fast: parseFloat(data.result.FastGasPrice),
              suggestBaseFee: parseFloat(data.result.suggestBaseFee),
              gasUsedRatio: data.result.gasUsedRatio
            };
          }
        }
      } catch (err) {
        errors.push({ source: 'etherscan', error: err.message });
      }
    }
    
    // Source 3: Direct RPC call (fallback)
    if (ETHEREUM_RPC) {
      try {
        const rpcResponse = await fetch(ETHEREUM_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_gasPrice',
            params: [],
            id: 1
          })
        });
        
        if (rpcResponse.ok) {
          const data = await rpcResponse.json();
          
          if (data.result) {
            // Convert from hex wei to gwei
            const gasPriceWei = parseInt(data.result, 16);
            const gasPriceGwei = gasPriceWei / 1e9;
            
            gasPrices.rpc = {
              gasPrice: gasPriceGwei
            };
          }
        }
        
        // Also fetch base fee from latest block
        const blockResponse = await fetch(ETHEREUM_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: ['latest', false],
            id: 2
          })
        });
        
        if (blockResponse.ok) {
          const blockData = await blockResponse.json();
          
          if (blockData.result?.baseFeePerGas) {
            const baseFeeWei = parseInt(blockData.result.baseFeePerGas, 16);
            const baseFeeGwei = baseFeeWei / 1e9;
            
            gasPrices.rpc.baseFee = baseFeeGwei;
          }
        }
      } catch (err) {
        errors.push({ source: 'rpc', error: err.message });
      }
    }
    
    // Aggregate and select best estimates
    const consensus = calculateConsensus(gasPrices);
    
    // Calculate profitability thresholds for different transaction types
    const thresholds = calculateProfitabilityThresholds(consensus);
    
    // Determine current network state
    const networkState = analyzeNetworkState(gasPrices, consensus);
    
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'gasPriceOracle',
      exchange: 'ethereum_mainnet',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'success',
      data: {
        sources: {
          infura: gasPrices.infura,
          etherscan: gasPrices.etherscan,
          rpc: gasPrices.rpc
        },
        consensus,
        thresholds,
        networkState,
        errors: errors.length > 0 ? errors : null
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'gasPriceOracle',
      exchange: 'ethereum_mainnet',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    };
  }
};

/**
 * Calculate consensus gas price from multiple sources
 * @param {Object} gasPrices - Gas prices from all sources
 * @returns {Object} Consensus gas prices
 */
function calculateConsensus(gasPrices) {
  const { infura, etherscan, rpc } = gasPrices;
  
  // Priority: Infura (most accurate for EIP-1559) > Etherscan > RPC
  const consensus = {
    instant: null,  // For urgent transactions
    fast: null,     // For flash loans (typical)
    standard: null, // For normal transactions
    slow: null,     // For non-urgent
    baseFee: null
  };
  
  // Use Infura as primary source (EIP-1559 compatible)
  if (infura) {
    consensus.instant = infura.high.maxFeePerGas;
    consensus.fast = infura.medium.maxFeePerGas;
    consensus.standard = infura.low.maxFeePerGas;
    consensus.slow = infura.low.maxFeePerGas * 0.9;
    consensus.baseFee = infura.estimatedBaseFee;
  }
  // Fallback to Etherscan
  else if (etherscan) {
    consensus.instant = etherscan.fast;
    consensus.fast = etherscan.propose;
    consensus.standard = etherscan.safe;
    consensus.slow = etherscan.safe * 0.9;
    consensus.baseFee = etherscan.suggestBaseFee;
  }
  // Last resort: RPC
  else if (rpc) {
    const basePrice = rpc.gasPrice || rpc.baseFee || 0;
    consensus.instant = basePrice * 1.5;
    consensus.fast = basePrice * 1.2;
    consensus.standard = basePrice;
    consensus.slow = basePrice * 0.9;
    consensus.baseFee = rpc.baseFee || basePrice;
  }
  
  // Round to 2 decimal places
  Object.keys(consensus).forEach(key => {
    if (consensus[key] !== null) {
      consensus[key] = Math.round(consensus[key] * 100) / 100;
    }
  });
  
  return consensus;
}

/**
 * Calculate minimum profit thresholds for different transaction types
 * @param {Object} consensus - Consensus gas prices
 * @returns {Object} Profitability thresholds in USD
 */
function calculateProfitabilityThresholds(consensus) {
  // Assume ETH price ~$2400 (will be replaced with real price from DEX data)
  const ETH_PRICE_USD = 2400;
  
  // Gas estimates for different transaction types (in gas units)
  const GAS_ESTIMATES = {
    simpleSwap: 150000,        // Basic Uniswap swap
    flashLoanSimple: 250000,   // Flash loan with 1 swap
    flashLoanTriangle: 400000, // Flash loan with 3 swaps (triangle arb)
    flashLoanComplex: 600000   // Complex multi-hop flash loan
  };
  
  const thresholds = {};
  
  Object.keys(GAS_ESTIMATES).forEach(txType => {
    const gasUnits = GAS_ESTIMATES[txType];
    
    // Calculate cost in ETH and USD for each speed
    thresholds[txType] = {
      slow: {
        gasCostETH: (consensus.slow * gasUnits) / 1e9,
        gasCostUSD: ((consensus.slow * gasUnits) / 1e9) * ETH_PRICE_USD,
        minProfitUSD: (((consensus.slow * gasUnits) / 1e9) * ETH_PRICE_USD) * 1.5 // 1.5x gas for safety margin
      },
      standard: {
        gasCostETH: (consensus.standard * gasUnits) / 1e9,
        gasCostUSD: ((consensus.standard * gasUnits) / 1e9) * ETH_PRICE_USD,
        minProfitUSD: (((consensus.standard * gasUnits) / 1e9) * ETH_PRICE_USD) * 1.5
      },
      fast: {
        gasCostETH: (consensus.fast * gasUnits) / 1e9,
        gasCostUSD: ((consensus.fast * gasUnits) / 1e9) * ETH_PRICE_USD,
        minProfitUSD: (((consensus.fast * gasUnits) / 1e9) * ETH_PRICE_USD) * 1.5
      },
      instant: {
        gasCostETH: (consensus.instant * gasUnits) / 1e9,
        gasCostUSD: ((consensus.instant * gasUnits) / 1e9) * ETH_PRICE_USD,
        minProfitUSD: (((consensus.instant * gasUnits) / 1e9) * ETH_PRICE_USD) * 1.5
      }
    };
    
    // Round to 2 decimal places
    Object.keys(thresholds[txType]).forEach(speed => {
      Object.keys(thresholds[txType][speed]).forEach(key => {
        thresholds[txType][speed][key] = Math.round(thresholds[txType][speed][key] * 100) / 100;
      });
    });
  });
  
  return thresholds;
}

/**
 * Analyze current network state
 * @param {Object} gasPrices - All gas price sources
 * @param {Object} consensus - Consensus prices
 * @returns {Object} Network state analysis
 */
function analyzeNetworkState(gasPrices, consensus) {
  const state = {
    congestion: 'unknown',
    recommendation: 'standard',
    flashLoanViable: true,
    warnings: []
  };
  
  // Determine congestion level
  if (consensus.fast) {
    if (consensus.fast < 30) {
      state.congestion = 'low';
      state.recommendation = 'slow';
    } else if (consensus.fast < 50) {
      state.congestion = 'normal';
      state.recommendation = 'standard';
    } else if (consensus.fast < 100) {
      state.congestion = 'high';
      state.recommendation = 'fast';
      state.warnings.push('High gas prices - only large arbitrage opportunities profitable');
    } else {
      state.congestion = 'extreme';
      state.recommendation = 'wait';
      state.flashLoanViable = false;
      state.warnings.push('Extremely high gas - flash loans likely unprofitable');
    }
  }
  
  // Check if Infura data includes congestion metric
  if (gasPrices.infura?.networkCongestion) {
    const infuraCongestion = gasPrices.infura.networkCongestion;
    if (infuraCongestion > 0.7) {
      state.warnings.push('Network congestion > 70%');
    }
  }
  
  // Add base fee analysis (EIP-1559)
  if (consensus.baseFee) {
    state.baseFeeGwei = consensus.baseFee;
    
    if (consensus.baseFee > 50) {
      state.warnings.push('High base fee - consider waiting for lower gas');
    }
  }
  
  return state;
}

// Allow running standalone for testing
if (require.main === module) {
  (async () => {
    console.log('Testing Gas Price Oracle...\n');
    const result = await module.exports();
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'success') {
      console.log('\n✅ Gas Price Oracle executed successfully');
      
      const { consensus, networkState, thresholds } = result.data;
      
      console.log('\n📊 Current Gas Prices (gwei):');
      console.log(`  Slow:     ${consensus.slow}`);
      console.log(`  Standard: ${consensus.standard}`);
      console.log(`  Fast:     ${consensus.fast}`);
      console.log(`  Instant:  ${consensus.instant}`);
      console.log(`  Base Fee: ${consensus.baseFee}`);
      
      console.log(`\n🌐 Network State: ${networkState.congestion.toUpperCase()}`);
      console.log(`   Recommendation: ${networkState.recommendation}`);
      console.log(`   Flash Loans Viable: ${networkState.flashLoanViable ? 'YES' : 'NO'}`);
      
      if (networkState.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        networkState.warnings.forEach(w => console.log(`   - ${w}`));
      }
      
      console.log('\n💰 Flash Loan Profitability (Triangle Arb):');
      const triangle = thresholds.flashLoanTriangle;
      console.log(`   Gas Cost (fast): $${triangle.fast.gasCostUSD}`);
      console.log(`   Min Profit Needed: $${triangle.fast.minProfitUSD}`);
      
    } else {
      console.log('\n❌ Gas Price Oracle failed');
      console.log(`Error: ${result.error.message}`);
    }
  })();
}
