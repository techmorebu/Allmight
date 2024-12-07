const { logger } = require('../monitoring/logger');
const { generateSignals } = require('../signal-generator');
const { executeTrade } = require('./trade-utils');
const fs = require('fs');
const path = require('path');

// Confidence threshold for AI signals
const CONFIDENCE_THRESHOLD = 0.7;

async function runLiveTrading() {
  try {
    logger.info('--- Starting Live Trading ---');

    // Step 1: Load trends data from file
    const trendsPath = path.join(__dirname, '../logs/trends-log.json');
    if (!fs.existsSync(trendsPath)) {
      throw new Error('Trends data file not found. Aborting live trading.');
    }

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));

    // Step 2: Generate signals using the updated signal generator
    const signals = await generateSignals(trends);
    if (!signals || Object.keys(signals).length === 0) {
      logger.error('No signals generated. Aborting live trading.');
      return;
    }

    // Step 3: Process each signal and execute trades
    for (const [token, { signal, confidence, price }] of Object.entries(signals)) {
      // Skip low-confidence signals
      if (confidence < CONFIDENCE_THRESHOLD) {
        logger.warn(`Skipping trade for ${token}: Low confidence (${confidence}).`);
        continue;
      }

      logger.info(`Executing trade for ${token}: Signal - ${signal}, Confidence - ${confidence}, Price - ${price}`);

      // Execute trade based on signal
      const tradeResult = await executeTrade(token, signal, price);
      if (tradeResult.success) {
        logger.info(`Trade successful for ${token}: ${JSON.stringify(tradeResult)}`);
      } else {
        logger.error(`Trade failed for ${token}: ${tradeResult.error}`);
      }
    }

    logger.info('Live trading session completed successfully.');
  } catch (error) {
    logger.error(`Error during live trading: ${error.message}`);
  }
}

if (require.main === module) {
  runLiveTrading();
}

module.exports = { runLiveTrading };
