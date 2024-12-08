function analyzeTrends(data) {
    logger.info('Starting trend analysis...');

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        logger.error('Invalid or empty data provided for analysis.');
        return null;
    }

    const trends = {};

    try {
        // Process CoinGecko data
        if (data.coingecko) {
            logger.info('Processing CoinGecko data...');
            for (const [token, metrics] of Object.entries(data.coingecko)) {
                if (metrics?.usd && metrics.usd > 0) {
                    trends[token] = {
                        source: 'CoinGecko',
                        price: metrics.usd,
                        marketCap: metrics.usd_market_cap || 0,
                        volume24h: metrics.usd_24h_vol || 0,
                        priceChange24h: metrics.usd_24h_change || 0,
                    };
                } else {
                    logger.warn(`Invalid price data for ${token} in CoinGecko response. Price: ${metrics?.usd}`);
                }
            }
        } else {
            logger.warn('No CoinGecko data provided.');
        }

        // Process GMX Arbitrum
        if (data.arbitrum?.prices) {
            logger.info('Processing GMX Arbitrum data...');
            for (const [token, metrics] of Object.entries(data.arbitrum.prices)) {
                if (metrics?.usd && metrics.usd > 0) {
                    trends[`GMX-Arbitrum-${token}`] = {
                        source: 'GMX Arbitrum',
                        price: metrics.usd,
                        volume24h: metrics.volume24h || 0,
                        priceChange24h: metrics.priceChange24h || 0,
                    };
                } else {
                    logger.warn(`Invalid price data for ${token} in GMX Arbitrum response. Price: ${metrics?.usd}`);
                }
            }
        } else {
            logger.warn('No GMX Arbitrum data provided.');
        }

        // Process GMX Avalanche
        if (data.avalanche?.prices) {
            logger.info('Processing GMX Avalanche data...');
            for (const [token, metrics] of Object.entries(data.avalanche.prices)) {
                if (metrics?.usd && metrics.usd > 0) {
                    trends[`GMX-Avalanche-${token}`] = {
                        source: 'GMX Avalanche',
                        price: metrics.usd,
                        volume24h: metrics.volume24h || 0,
                        priceChange24h: metrics.priceChange24h || 0,
                    };
                } else {
                    logger.warn(`Invalid price data for ${token} in GMX Avalanche response. Price: ${metrics?.usd}`);
                }
            }
        } else {
            logger.warn('No GMX Avalanche data provided.');
        }

        saveTrends(trends);

        logger.info(`Trends summary: ${Object.keys(trends).length} trend(s) processed.`);
        logger.info('Trend analysis completed.');
        return trends;
    } catch (error) {
        logger.error(`Error during trend analysis: ${error.message}`);
        return null;
    }
}
module.exports = { analyzeTrends };
