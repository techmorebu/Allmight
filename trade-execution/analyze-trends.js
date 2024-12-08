const { logger } = require('../monitoring/logger');
const fs = require('fs');
const path = require('path');

function analyzeTrends(data) {
    logger.info('Starting trend analysis...');

    // Validate input data
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        logger.error('Invalid or empty data provided for analysis.');
        return null;
    }

    const trends = {};

    try {
        // Process CoinGecko data
        if (data.coingecko) {
            for (const [token, metrics] of Object.entries(data.coingecko)) {
                trends[token] = {
                    source: 'CoinGecko',
                    price: metrics?.usd || 0,
                    marketCap: metrics?.usd_market_cap || 0,
                    volume24h: metrics?.usd_24h_vol || 0,
                    priceChange24h: metrics?.usd_24h_change || 0,
                };
            }
        } else {
            logger.warn('No CoinGecko data provided.');
        }

        // Process GMX data (Arbitrum)
        if (data.arbitrum?.prices) {
            for (const [token, metrics] of Object.entries(data.arbitrum.prices)) {
                trends[`GMX-Arbitrum-${token}`] = {
                    source: 'GMX Arbitrum',
                    price: metrics?.usd || 0,
                    volume24h: metrics?.usd_24h_vol || 0,
                    priceChange24h: metrics?.usd_24h_change || 0,
                };
            }
        } else {
            logger.warn('No GMX Arbitrum data provided.');
        }

        // Process GMX data (Avalanche)
        if (data.avalanche?.prices) {
            for (const [token, metrics] of Object.entries(data.avalanche.prices)) {
                trends[`GMX-Avalanche-${token}`] = {
                    source: 'GMX Avalanche',
                    price: metrics?.usd || 0,
                    volume24h: metrics?.usd_24h_vol || 0,
                    priceChange24h: metrics?.usd_24h_change || 0,
                };
            }
        } else {
            logger.warn('No GMX Avalanche data provided.');
        }

        // Save trends to file
        saveTrends(trends);

        logger.info(`Trends summary: ${Object.keys(trends).length} trend(s) processed.`);
        logger.info('Trend analysis completed.');
        return trends;
    } catch (error) {
        logger.error(`Error during trend analysis: ${error.message}`);
        return null;
    }
}

function saveTrends(trends) {
    const logPath = path.resolve(__dirname, '../logs/trends-log.json');

    try {
        fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
        logger.info(`Trends saved to ${logPath}`);
    } catch (error) {
        logger.error(`Error saving trends to file: ${error.message}`);
    }
}

module.exports = { analyzeTrends };
