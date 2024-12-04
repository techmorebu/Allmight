const { logger } = require('../monitoring/logger');
const fs = require('fs');

function analyzeTrends(data) {
  logger.info('Starting trend analysis...');

  if (!data) {
    logger.error('No data provided for analysis.');
    return null;
  }

  const trends = {};

  // Process CoinGecko data
  if (data.coingecko) {
    for (const [token, metrics] of Object.entries(data.coingecko)) {
      trends[token] = {
        source: 'CoinGecko',
        price: metrics.usd,
        marketCap: metrics.usd_market_cap,
        volume24h: metrics.usd_24h_vol,
        priceChange24h: metrics.usd_24h_change,
      };
    }
  }

  // Process GMX data (Arbitrum)
  if (data.arbitrum) {
    trends['GMX-Arbitrum'] = {
      source: 'GMX Arbitrum',
      tokens: data.arbitrum.tokens,
      prices: data.arbitrum.prices,
      pairs: data.arbitrum.pairs,
    };
  }

  // Process GMX data (Avalanche)
  if (data.avalanche) {
    trends['GMX-Avalanche'] = {
      source: 'GMX Avalanche',
      tokens: data.avalanche.tokens,
      prices: data.avalanche.prices,
      pairs: data.avalanche.pairs,
    };
  }

  // Save trends to a file
  saveTrends(trends);
  logger.info('Trend analysis completed.');
  return trends;
}

function saveTrends(trends) {
  const logPath = './logs/trends-log.json';
  fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
  logger.info(`Trends saved to ${logPath}`);
}

module.exports = { analyzeTrends };
