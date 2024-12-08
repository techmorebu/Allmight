// Corrected paths
const { logger } = require('../monitoring/logger'); // No change
const fs = require('fs');
const path = require('path');
const { predictSignals } = require('../ai-models/predict-signals'); // Assuming ai-models is a sibling folder to trade-execution


// Generate trade signals using AI or fallback logic
async function generateSignals(trends) {
  logger.info('Generating trading signals...');

  if (!trends || Object.keys(trends).length === 0) {
    logger.error('No trends data provided for signal generation.');
    return null;
  }

  try {
    // Attempt to use AI for signal generation
    logger.info('Using AI model for signal generation...');
    const aiSignals = await predictSignals(trends);

    if (aiSignals && Object.keys(aiSignals).length > 0) {
      logger.info('AI signals generated successfully:', JSON.stringify(aiSignals, null, 2));
      return aiSignals;
    } else {
      throw new Error('AI signal generation returned no results.');
    }
  } catch (error) {
    logger.warn(`AI signal generation failed: ${error.message}. Falling back to static logic.`);

    // Fallback to static logic
    const fallbackSignals = {};
    for (const [token, { price, priceChange24h }] of Object.entries(trends)) {
      const signal =
        priceChange24h > 2
          ? 'Buy'
          : priceChange24h < -2
          ? 'Sell'
          : 'Hold';

      fallbackSignals[token] = {
        token,
        price,
        signal,
        priceChange24h,
      };

      logger.info(`Fallback signal for ${token}: ${signal}`);
    }
    return fallbackSignals;
  }
}

// Save generated signals to a log file
function saveSignals(signals) {
  const logPath = path.join(__dirname, '../logs/signals-log.json');
  fs.writeFileSync(logPath, JSON.stringify(signals, null, 2), 'utf8');
  logger.info(`Signals saved to ${logPath}`);
}

// Main execution block for standalone use
if (require.main === module) {
  (async () => {
    try {
      logger.info('--- Starting Signal Generation ---');

      // Load trends data from file (assumes trends-log.json exists)
      const trendsPath = path.join(__dirname, '../logs/trends-log.json');
      if (!fs.existsSync(trendsPath)) {
        throw new Error('Trends data file not found. Aborting signal generation.');
      }

      const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));
      const signals = await generateSignals(trends);

      if (signals) {
        saveSignals(signals);
        logger.info('Signal generation completed successfully.');
      } else {
        logger.error('Signal generation failed. No signals generated.');
      }
    } catch (error) {
      logger.error(`Error during signal generation: ${error.message}`);
    }
  })();
}

module.exports = { generateSignals };
