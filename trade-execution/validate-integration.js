require('dotenv').config({ path: '/.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        // Debugging: Log environment variables
        logger.info(`Loaded GMX_ARBITRUM_TICKERS_URL: ${process.env.GMX_ARBITRUM_TICKERS_URL}`);
        logger.info(`Loaded GMX_AVALANCHE_TICKERS_URL: ${process.env.GMX_AVALANCHE_TICKERS_URL}`);

        // Step 1: Fetch GMX Tickers
        logger.info('Fetching GMX tickers for Arbitrum...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        logger.info(`Fetched Arbitrum tickers: ${JSON.stringify(arbitrumTickers, null, 2)}`);

        logger.info('Fetching GMX tickers for Avalanche...');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        logger.info(`Fetched Avalanche tickers: ${JSON.stringify(avalancheTickers, null, 2)}`);

        // Step 2: Fetch Candlestick Data
        logger.info('Fetching GMX candlesticks for Arbitrum (ETH, 1d)...');
        const arbitrumCandles = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        logger.info(`Fetched Arbitrum candlesticks: ${JSON.stringify(arbitrumCandles, null, 2)}`);

        logger.info('Fetching GMX candlesticks for Avalanche (AVAX, 1d)...');
        const avalancheCandles = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');
        logger.info(`Fetched Avalanche candlesticks: ${JSON.stringify(avalancheCandles, null, 2)}`);

        // Step 3: Combine Data
        const combinedData = {
            arbitrum: { tickers: arbitrumTickers, candles: arbitrumCandles },
            avalanche: { tickers: avalancheTickers, candles: avalancheCandles },
        };
        logger.info(`Combined GMX data: ${JSON.stringify(combinedData, null, 2)}`);

        // Step 4: Analyze Trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(combinedData);
        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('No trends generated from analysis.');
        }
        logger.info(`Trends analysis completed successfully: ${JSON.stringify(trends, null, 2)}`);

        // Step 5: Generate Trading Signals
        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);
        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('No trading signals generated.');
        }
        logger.info(`Trading signals generated successfully: ${JSON.stringify(signals, null, 2)}`);

        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

// Execute the validation process
validateIntegration();
