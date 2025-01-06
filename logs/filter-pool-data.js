const fs = require('fs');
const path = require('path');

// Load the raw pools data
const rawDataPath = path.join(__dirname, '../logs/arbitrage-ready-pools.json');
const filteredDataPath = path.join(__dirname, '../logs/final-pools.json');

const rawPools = JSON.parse(fs.readFileSync(rawDataPath));

// Helper function to calculate averages
const calculateAverage = (pools, field) => {
  const validValues = pools.map((pool) => parseFloat(pool[field] || 0)).filter((val) => !isNaN(val));
  return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
};

// Calculate averages for dynamic thresholds
const avgVolume = calculateAverage(rawPools, 'volumeUSD');
const avgLiquidity = calculateAverage(rawPools, 'liquidity');
const avgFees = calculateAverage(rawPools, 'feesUSD');

console.log(`📊 Averages: Volume = ${avgVolume}, Liquidity = ${avgLiquidity}, Fees = ${avgFees}`);

// Define thresholds
const volumeThreshold = avgVolume * 0.8; // 80% of average
const liquidityThreshold = avgLiquidity * 0.8;
const feesThreshold = avgFees * 0.8;

console.log(`📈 Thresholds: Volume > ${volumeThreshold}, Liquidity > ${liquidityThreshold}, Fees > ${feesThreshold}`);

const validPools = [];

rawPools.forEach((pool) => {
  const volume = parseFloat(pool.volumeUSD || 0);
  const liquidity = parseFloat(pool.liquidity || 0);
  const fees = parseFloat(pool.feesUSD || 0);

  let isValid = true;

  // Validation conditions
  if (volume < volumeThreshold) {
    console.log(`⚠️ Pool ${pool.id} excluded: Low volume (${volume})`);
    isValid = false;
  }
  if (liquidity < liquidityThreshold) {
    console.log(`⚠️ Pool ${pool.id} excluded: Low liquidity (${liquidity})`);
    isValid = false;
  }
  if (fees < feesThreshold) {
    console.log(`⚠️ Pool ${pool.id} excluded: Low fees (${fees})`);
    isValid = false;
  }

  if (isValid) {
    // Include token names and symbols in the filtered result
    validPools.push({
      id: pool.id,
      volumeUSD: pool.volumeUSD,
      liquidity: pool.liquidity,
      feesUSD: pool.feesUSD,
      token0: {
        id: pool.token0.id,
        name: pool.token0.name,
        symbol: pool.token0.symbol,
      },
      token1: {
        id: pool.token1.id,
        name: pool.token1.name,
        symbol: pool.token1.symbol,
      },
    });
  }
});

// Save the filtered pools with token metadata
fs.writeFileSync(filteredDataPath, JSON.stringify(validPools, null, 2));
console.log(`✅ Valid pools saved to ${filteredDataPath}`);
