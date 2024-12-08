async function fetchGmxPrices(apiUrl, chainName) {
    try {
        if (!apiUrl) {
            throw new Error(`API URL for ${chainName} is not set or invalid.`);
        }

        logger.info(`Fetching GMX token prices from ${chainName} API: ${apiUrl}`);

        const response = await axios.get(apiUrl);
        const data = response.data;

        // Log raw response for debugging
        logger.debug(`Raw API response from ${chainName}: ${JSON.stringify(data, null, 2)}`);

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
