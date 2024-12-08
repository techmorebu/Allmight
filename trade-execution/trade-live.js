const { logger } = require('../monitoring/logger');
const { generateSignals } = require('./signal-generator');
const { executeTrade } = require('./trade-utils');
const fs = require('fs');
const path = require('path');

const CONFIDENCE_THRESHOLD = 0.7;

async function runLiveTrading() {
    try {
        logger.info('--- Starting Live Trading ---');

        const trendsPath = path.join(__dirname, '../logs/trends-log.json');
        if (!fs.existsSync(trendsPath)) {
            throw new Error('Trends data file not found. Aborting live trading.');
        }

        const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));
        const signals = await generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            logger.error('No signals generated. Aborting live trading.');
            return;
        }

        for (const [token, { signal, confidence, price }] of Object.entries(signals)) {
            if (confidence < CONFIDENCE_THRESHOLD) {
                logger.warn(`Skipping trade for ${token}: Low confidence (${confidence}).`);
                continue;
            }

            if (!price) {
                logger.warn(`Skipping trade for ${token}: Price data is unavailable.`);
                continue;
            }

            logger.info(`Executing trade for ${token}: Signal - ${signal}, Confidence - ${confidence}, Price - ${price}`);
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
