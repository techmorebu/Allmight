const axios = require('axios');
const { logger } = require('../monitoring/logger');

require('dotenv').config({ path: '/home/techbu/OFA_Project_Local/ofa-project/.env' });

const GMX_ARBITRUM_API = process.env.GMX_ARBITRUM_API;
const GMX_AVALANCHE_API = process.env.GMX_AVALANCHE_API;

async function fetchGmxPrices(apiUrl, chainName) {
    try {
        if (!apiUrl) {
            throw new Error(`API URL for ${chainName} is not set or invalid.`);
        }

        logger.info(`Fetching GMX token prices from ${chainName} API: ${apiUrl}`);

        const response = await axios.get(apiUrl);
        const data = response.data;

        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid data format received from ${chainName} API.`);
        }

        logger.info(`Successfully fetched data from ${chainName}. Validating response structure...`);

        const prices = {};
        for (const [token, metrics] of Object.entries(data.prices || {})) {
            if (metrics && metrics.usd) {
                prices[token] = {
                    usd: metrics.usd,
                    volume24h: metrics.usd_24h_vol || 0,
                    priceChange24h: metrics.usd_24h_change || 0,
                };
            } else {
                logger.warn(`Price data missing or invalid for token ${token} on ${chainName}.`);
            }
        }

        logger.info(`${Object.keys(prices).length} valid token prices extracted from ${chainName}.`);
        return prices;
    } catch (error) {
        logger.error(`Error fetching GMX token prices from ${chainName}: ${error.message}`);
        return null;
    }
}

async function fetchGmxData() {
    logger.info('--- Starting GMX Data Fetch ---');

    const arbitrumPrices = await fetchGmxPrices(GMX_ARBITRUM_API, 'Arbitrum');
    const avalanchePrices = await fetchGmxPrices(GMX_AVALANCHE_API, 'Avalanche');

    const data = {
        arbitrum: { prices: arbitrumPrices || {} },
        avalanche: { prices: avalanchePrices || {} },
    };

    logger.info('GMX Data Fetch completed.');
    return data;
}

module.exports = { fetchGmxData };
