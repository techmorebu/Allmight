const { logger } = require('../monitoring/logger');
const fs = require('fs');
const path = require('path');

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

// Save generated signals to a log file
function saveSignals(signals) {
  const logPath = path.join(__dirname, '../logs/signals-log.json');
  fs.writeFileSync(logPath, JSON.stringify(signals, null, 2), 'utf8');
  logger.info(`Signals saved to ${logPath}`);
}

// Main execution block for standalone use
if (require.main === module) {
  try {
    logger.info('--- Starting Signal Generation ---');

    // Load trends data from file (assumes trends-log.json exists)
    const trendsPath = path.join(__dirname, '../logs/trends-log.json');
    if (!fs.existsSync(trendsPath)) {
      throw new Error('Trends data file not found. Aborting signal generation.');
    }

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));
    const signals = generateSignals(trends);

    if (signals) {
      saveSignals(signals);
      logger.info('Signal generation completed successfully.');
    } else {
      logger.error('Signal generation failed. No signals generated.');
    }
  } catch (error) {
    logger.error(`Error during signal generation: ${error.message}`);
  }
}

module.exports = { generateSignals };
