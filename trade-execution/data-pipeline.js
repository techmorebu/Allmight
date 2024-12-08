require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('./fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch GMX token prices (Tickers)
        logger.info('Fetching GMX token prices (Tickers)...');
        const gmxTickers = await fetchGmxData('arbitrum', 'tickers');

        if (!gmxTickers || gmxTickers.length === 0) {
            logger.error('Failed to fetch GMX tickers. Aborting pipeline.');
            return;
        }
        logger.info('GMX token prices (Tickers) fetched successfully.');

        // Step 2: Fetch GMX candlestick data
        logger.info('Fetching GMX candlestick data...');
        const gmxCandlesticks = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');

        if (!gmxCandlesticks || gmxCandlesticks.length === 0) {
            logger.error('Failed to fetch GMX candlestick data. Aborting pipeline.');
            return;
        }
        logger.info('GMX candlestick data fetched successfully.');

        // Combine data for analysis
        const combinedData = {
            tickers: gmxTickers,
            candlesticks: gmxCandlesticks,
        };
        logger.info('Combined GMX data for analysis:', JSON.stringify(combinedData, null, 2));

        // Step 3: Analyze trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(combinedData);

        if (!trends || Object.keys(trends).length === 0) {
            logger.error('No trends generated from analysis. Aborting pipeline.');
            return;
        }
        logger.info('Trends generated successfully:', JSON.stringify(trends, null, 2));

        // Step 4: Generate trading signals
        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            logger.error('No trading signals generated. Aborting pipeline.');
            return;
        }

        logger.info('Generated trading signals:', JSON.stringify(signals, null, 2));
    } catch (error) {
        logger.error(`Error in data pipeline: ${error.message}`);
    }
}

module.exports = { runDataPipeline };
