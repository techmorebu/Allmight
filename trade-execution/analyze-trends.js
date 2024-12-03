const fs = require('fs');
const { logger } = require('../monitoring/logger');

// Analyze trends from fetched CoinGecko data
function analyzeTrends(tokenData) {
  logger.info('Starting trend analysis...');

  if (!tokenData || Object.keys(tokenData).length === 0) {
    logger.error('No data provided for analysis.');
    return null;
  }

  // Process data
  const trends = {};
  for (const [token, data] of Object.entries(tokenData)) {
    const {
      usd: price,
      usd_market_cap: marketCap,
      usd_24h_vol: volume24h,
      usd_24h_change: priceChange24h,
    } = data;

    trends[token] = {
      price,
      marketCap,
      volume24h,
      priceChange24h,
    };

    logger.info(
      `Processed ${token}: Price: $${price}, Market Cap: $${marketCap}, 24h Volume: $${volume24h}, 24h Change: ${priceChange24h}%`
    );
  }

  // Save trends to a log file
  saveTrends(trends);

  logger.info('Trend analysis completed.');
  return trends;
}

// Save trends to a JSON log file
function saveTrends(trends) {
  const logPath = './logs/trends-log.json';
  fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
  logger.info(`Trends saved to ${logPath}`);
}

module.exports = { analyzeTrends };

// Test Example
if (require.main === module) {
  const testData = {
    ethereum: {
      usd: 3612.93,
      usd_market_cap: 435145092801.0696,
      usd_24h_vol: 44211393381.66678,
      usd_24h_change: 0.3199,
    },
    zksync: {
      usd: 0.2207,
      usd_market_cap: 811185501.2918984,
      usd_24h_vol: 261252014.8039644,
      usd_24h_change: 3.7264,
    },
  };

  const trends = analyzeTrends(testData);
  console.log('Trends:', trends);
}
