const { logger } = require('../monitoring/logger');
const fs = require('fs');

function analyzeTrends(data) {
  logger.info('Starting trend analysis...');

  if (!data || Object.keys(data).length === 0) {
    logger.error('No data provided for analysis.');
    return null;
  }

  const trends = {};

  // Process CoinGecko data
  if (data.coingecko) {
    for (const [token, metrics] of Object.entries(data.coingecko)) {
      if (metrics && metrics.usd && metrics.usd_24h_vol) {
        trends[token] = {
          source: 'CoinGecko',
          price: metrics.usd,
          marketCap: metrics.usd_market_cap || 0,
          volume24h: metrics.usd_24h_vol,
          priceChange24h: metrics.usd_24h_change || 0,
        };
        logger.info(`Processed CoinGecko data for ${token}`);
      } else {
        logger.warn(`Incomplete CoinGecko data for ${token}. Skipping.`);
      }
    }
  } else {
    logger.warn('No CoinGecko data provided.');
  }

  // Process GMX data (Arbitrum)
  if (data.arbitrum) {
    trends['GMX-Arbitrum'] = {
      source: 'GMX Arbitrum',
      tokens: data.arbitrum.tokens || {},
      prices: data.arbitrum.prices || {},
      pairs: data.arbitrum.pairs || {},
    };
    logger.info('Processed GMX Arbitrum data.');
  } else {
    logger.warn('No GMX Arbitrum data provided.');
  }

  // Process GMX data (Avalanche)
  if (data.avalanche) {
    trends['GMX-Avalanche'] = {
      source: 'GMX Avalanche',
      tokens: data.avalanche.tokens || {},
      prices: data.avalanche.prices || {},
      pairs: data.avalanche.pairs || {},
    };
    logger.info('Processed GMX Avalanche data.');
  } else {
    logger.warn('No GMX Avalanche data provided.');
  }

  // Log summary of trends
  logger.info(`Trends summary: ${Object.keys(trends).length} trend(s) processed.`);

  // Save trends to a file
  saveTrends(trends);
  logger.info('Trend analysis completed.');

  return trends;
}

function saveTrends(trends) {
  const logPath = './logs/trends-log.json';
  try {
    fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
    logger.info(`Trends saved to ${logPath}`);
  } catch (error) {
    logger.error(`Error saving trends to file: ${error.message}`);
  }
}

module.exports = { analyzeTrends };
