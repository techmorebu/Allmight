const { logger } = require('../monitoring/logger');

// Generate trade signals based on trends
function generateSignals(trends) {
  logger.info('Generating trading signals...');

  if (!trends || Object.keys(trends).length === 0) {
    logger.error('No trends data provided for signal generation.');
    return null;
  }

  const signals = {};
  for (const [token, { price, priceChange24h }] of Object.entries(trends)) {
    const signal =
      priceChange24h > 2
        ? 'Buy'
        : priceChange24h < -2
        ? 'Sell'
        : 'Hold';

    signals[token] = {
      token,
      price,
      signal,
      priceChange24h,
    };

    logger.info(`Generated signal for ${token}: ${signal}`);
  }

  return signals;
}

module.exports = { generateSignals };
