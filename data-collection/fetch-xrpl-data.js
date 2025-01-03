require('dotenv').config();
const axios = require('axios');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const XRPL_MAINNET_URL = process.env.XRPL_MAINNET_URL;
const XRPL_PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;

if (!XRPL_MAINNET_URL || !XRPL_PUBLIC_KEY) {
    logger.error("Environment variables XRPL_MAINNET_URL or XRPL_PUBLIC_KEY are missing.");
    process.exit(1);
}

const redisClient = new Redis();

async function fetchServerInfo() {
    try {
        logger.info("Starting XRPL fetcher script using JSON-RPC...");
        logger.info(`Sending server_info request to XRPL at ${XRPL_MAINNET_URL}...`);

        const response = await axios.post(XRPL_MAINNET_URL, {
            method: "server_info",
            params: [{}],
        });

        if (response.data && response.data.result) {
            logger.info("Received response from XRPL:");
            logger.info(`Server Info: ${JSON.stringify(response.data.result.info, null, 2)}`);

            // Store in Redis
            redisClient.set("xrpl:server_info", JSON.stringify(response.data.result.info), (err, reply) => {
                if (err) {
                    logger.error(`Error storing server_info in Redis: ${err.message}`);
                } else {
                    logger.info(`Successfully stored server_info in Redis with key: xrpl:server_info`);
                }
            });
        } else {
            logger.error("Unexpected response format or missing result in server_info.");
        }
    } catch (error) {
        logger.error(`Error fetching server_info: ${error.message}`);
    }
}

async function fetchAccountInfo() {
    try {
        logger.info(`Fetching account info for public key: ${XRPL_PUBLIC_KEY}...`);

        const response = await axios.post(XRPL_MAINNET_URL, {
            method: "account_info",
            params: [
                {
                    account: XRPL_PUBLIC_KEY,
                    ledger_index: "validated",
                },
            ],
        });

        if (response.data && response.data.result) {
            logger.info("Received account info from XRPL:");
            logger.info(`Account Info: ${JSON.stringify(response.data.result.account_data, null, 2)}`);

            // Store in Redis
            redisClient.set(`xrpl:account:${XRPL_PUBLIC_KEY}`, JSON.stringify(response.data.result.account_data), (err, reply) => {
                if (err) {
                    logger.error(`Error storing account info in Redis: ${err.message}`);
                } else {
                    logger.info(`Successfully stored account info in Redis with key: xrpl:account:${XRPL_PUBLIC_KEY}`);
                }
            });
        } else {
            logger.error("Unexpected response format or missing result in account_info.");
        }
    } catch (error) {
        logger.error(`Error fetching account_info: ${error.message}`);
    }
}

async function fetchAccountTransactions() {
    try {
        logger.info(`Fetching account transactions for public key: ${XRPL_PUBLIC_KEY}...`);

        const response = await axios.post(XRPL_MAINNET_URL, {
            method: "account_tx",
            params: [
                {
                    account: XRPL_PUBLIC_KEY,
                    limit: 10,
                },
            ],
        });

        if (response.data && response.data.result) {
            logger.info("Received account transactions from XRPL:");
            logger.info(`Transactions: ${JSON.stringify(response.data.result.transactions, null, 2)}`);

            // Store in Redis
            redisClient.set(`xrpl:tx:${XRPL_PUBLIC_KEY}`, JSON.stringify(response.data.result.transactions), (err, reply) => {
                if (err) {
                    logger.error(`Error storing transactions in Redis: ${err.message}`);
                } else {
                    logger.info(`Successfully stored transactions in Redis with key: xrpl:tx:${XRPL_PUBLIC_KEY}`);
                }
            });
        } else {
            logger.error("Unexpected response format or missing result in account_tx.");
        }
    } catch (error) {
        logger.error(`Error fetching account transactions: ${error.message}`);
    }
}

(async function main() {
    try {
        await fetchServerInfo();
        await fetchAccountInfo();
        await fetchAccountTransactions();
        logger.info("XRPL fetcher script completed successfully.");
    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    } finally {
        redisClient.quit();
    }
})();
