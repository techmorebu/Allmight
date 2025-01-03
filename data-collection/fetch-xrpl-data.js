const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const XRPL_HTTP_URL = "https://s1.ripple.com:51234"; // JSON-RPC URL

(async () => {
    logger.info("Starting XRPL fetcher script using JSON-RPC...");

    if (!XRPL_HTTP_URL) {
        logger.error("Missing XRPL_HTTP_URL. Please provide a valid JSON-RPC endpoint.");
        process.exit(1);
    }

    try {
        logger.info(`Sending server_info request to XRPL at ${XRPL_HTTP_URL}...`);

        const response = await axios.post(XRPL_HTTP_URL, {
            method: "server_info",
            params: [{}],
        });

        logger.info("Received response from XRPL:");
        logger.debug(JSON.stringify(response.data, null, 2));

        // Example: Extracting specific information from the response
        const serverInfo = response.data.result.info;
        logger.info(`Server Info: ${JSON.stringify(serverInfo, null, 2)}`);
    } catch (error) {
        if (error.response) {
            logger.error(`Error response from XRPL: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            logger.error(`Error in XRPL fetcher script: ${error.message}`);
        }
    }
})();
