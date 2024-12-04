const { logger } = require('../monitoring/logger');
const fs = require('fs');

function analyzeTrends(data) {
    logger.info('Starting trend analysis...');

    if (!data || typeof data !== 'object') {
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
    } else {
        logger.warn('No CoinGecko data provided.');
    }

    // Process GMX data (Arbitrum)
    if (data.arbitrum && data.arbitrum.prices && data.arbitrum.pairs) {
        trends['GMX-Arbitrum'] = {
            source: 'GMX Arbitrum',
            prices: data.arbitrum.prices,
            pairs: data.arbitrum.pairs,
        };
    } else {
        logger.warn('No GMX Arbitrum data provided.');
    }

    // Process GMX data (Avalanche)
    if (data.avalanche && data.avalanche.prices && data.avalanche.pairs) {
        trends['GMX-Avalanche'] = {
            source: 'GMX Avalanche',
            prices: data.avalanche.prices,
            pairs: data.avalanche.pairs,
        };
    } else {
        logger.warn('No GMX Avalanche data provided.');
    }

    saveTrends(trends);
    logger.info(`Trends summary: ${Object.keys(trends).length} trend(s) processed.`);
    logger.info('Trend analysis completed.');
    return trends;
}

function saveTrends(trends) {
    const logPath = './logs/trends-log.json';
    fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
    logger.info(`Trends saved to ${logPath}`);
}

module.exports = { analyzeTrends };
