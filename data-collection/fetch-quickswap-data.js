const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

// Environment Variables
const QUICKSWAP_API_URL = process.env.QUICKSWAP_API;
const redis = new Redis();

// Function to fetch QuickSwap data
async function fetchQuickSwapData() {
    logger.info("Starting QuickSwap data fetcher...");

    try {
        logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);

        const response = await axios.post(QUICKSWAP_API_URL, {
            query: `
                {
                    pairs(first: 10) {
                        id
                        token0 {
                            symbol
                        }
                        token1 {
                            symbol
                        }
                        reserveUSD
                    }
                }
            `,
        });

        // Log raw API response for debugging
        logger.info(`HTTP Status Code: ${response.status}`);
        logger.info("Full API Response:", JSON.stringify(response.data, null, 2));

        // Validate API response
        if (!response.data || !response.data.data) {
            throw new Error("Invalid or null response from QuickSwap API.");
        }

        const pairs = response.data.data.pairs || [];
        if (pairs.length === 0) {
            throw new Error("No pairs data found in QuickSwap API response.");
        }

        logger.info(`Fetched ${pairs.length} QuickSwap pairs successfully.`);

        // Store data in Redis
        await redis.set("quickswap:pairs", JSON.stringify(pairs));
        logger.info("Stored pairs data in Redis.");
    } catch (error) {
        logger.error(`Error fetching QuickSwap data: ${error.message}`);
        if (error.response) {
            logger.error(`Response Status: ${error.response.status}`);
            logger.error(`Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            logger.error("Detailed Error:", error);
        }
    } finally {
        redis.disconnect();
    }
}

// Execute the function
fetchQuickSwapData();
