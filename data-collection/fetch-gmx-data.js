const axios = require('axios');
const logger = require('../monitoring/logger'); // Adjust the path to your logger if necessary.

async function fetchGmxTokenPrices(apiUrl, chainName) {
    try {
        if (!apiUrl) {
            throw new Error(`API URL for ${chainName} is not set.`);
        }

        logger.info(`Fetching GMX token prices from ${chainName} (${apiUrl})...`);

        const response = await axios.get(apiUrl);
        const data = response.data;

        // Debug raw response
        logger.debug(`Raw response from ${chainName}: ${JSON.stringify(data, null, 2)}`);

        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid response format from ${chainName}.`);
        }

        const prices = {};
        for (const [token, metrics] of Object.entries(data.prices || {})) {
            if (metrics && metrics.usd) {
                prices[token] = {
                    usd: metrics.usd,
                    volume24h: metrics.usd_24h_vol || 0,
                    priceChange24h: metrics.usd_24h_change || 0,
                };
            } else {
                logger.warn(`Missing or invalid price data for ${token} in ${chainName}.`);
            }
        }

        logger.info(`${Object.keys(prices).length} token prices fetched from ${chainName}.`);
        return prices;
    } catch (error) {
        logger.error(`Error fetching GMX token prices from ${chainName}: ${error.message}`);
        return {};
    }
}

module.exports = { fetchGmxTokenPrices };
