require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

const XRPL_MAINNET_URL = process.env.XRPL_MAINNET_URL;
const XRPL_PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;

async function fetchServerInfo() {
    try {
        logger.info(`Sending server_info request to XRPL at ${XRPL_MAINNET_URL}...`);
        const response = await axios.post(XRPL_MAINNET_URL, {
            method: 'server_info',
            params: [{}]
        });
        logger.info('Server Info:', response.data.result.info);
        return response.data.result.info;
    } catch (error) {
        logger.error(`Error fetching server info: ${error.message}`);
        throw error;
    }
}

async function fetchAccountBalances() {
    try {
        logger.info(`Fetching account balances for ${XRPL_PUBLIC_KEY}...`);
        const response = await axios.post(XRPL_MAINNET_URL, {
            method: 'account_info',
            params: [{ account: XRPL_PUBLIC_KEY, ledger_index: 'validated' }]
        });
        logger.info('Account Balances:', response.data.result.account_data);
        return response.data.result.account_data;
    } catch (error) {
        logger.error(`Error fetching account balances: ${error.message}`);
        throw error;
    }
}

async function fetchTransactionHistory() {
    try {
        logger.info(`Fetching transaction history for ${XRPL_PUBLIC_KEY}...`);
        const response = await axios.post(XRPL_MAINNET_URL, {
            method: 'account_tx',
            params: [{ account: XRPL_PUBLIC_KEY, ledger_index_min: -1, limit: 5 }]
        });
        logger.info('Transaction History:', response.data.result.transactions);
        return response.data.result.transactions;
    } catch (error) {
        logger.error(`Error fetching transaction history: ${error.message}`);
        throw error;
    }
}

async function storeInRedis(key, data) {
    try {
        logger.info(`Storing data in Redis under key: ${key}...`);
        await redis.set(key, JSON.stringify(data));
        logger.info(`Data successfully stored for key: ${key}`);
    } catch (error) {
        logger.error(`Error storing data in Redis: ${error.message}`);
        throw error;
    }
}

async function runFetcher() {
    logger.info('Starting XRPL fetcher script...');
    try {
        const serverInfo = await fetchServerInfo();
        await storeInRedis('xrpl:server_info', serverInfo);

        const accountBalances = await fetchAccountBalances();
        await storeInRedis(`xrpl:account:${XRPL_PUBLIC_KEY}`, accountBalances);

        const transactionHistory = await fetchTransactionHistory();
        await storeInRedis(`xrpl:tx:${XRPL_PUBLIC_KEY}`, transactionHistory);

        logger.info('XRPL fetcher script completed successfully.');
    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    } finally {
        redis.disconnect();
    }
}

runFetcher();
