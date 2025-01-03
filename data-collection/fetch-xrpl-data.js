require('dotenv').config();
const { createClient } = require('redis');
const fetch = require('node-fetch');
const { logger } = require('../monitoring/logger');

const redis = createClient();
redis.connect();

const XRPL_URL = process.env.XRPL_MAINNET_URL;
const XRPL_PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;

async function fetchServerInfo() {
    try {
        logger.info('Fetching server info from XRPL...');
        const response = await fetch(XRPL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'server_info',
                params: [{}]
            })
        });
        const data = await response.json();
        if (data.result) {
            logger.info('Server info fetched successfully.');
            await redis.set('xrpl:server_info', JSON.stringify(data.result));
            logger.info('Stored server info in Redis.');
        } else {
            logger.error('Failed to fetch server info:', data.error_message || data);
        }
    } catch (error) {
        logger.error(`Error fetching server info: ${error.message}`);
    }
}

async function fetchAccountInfo() {
    try {
        logger.info(`Fetching account info for: ${XRPL_PUBLIC_KEY}...`);
        const response = await fetch(XRPL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_info',
                params: [{ account: XRPL_PUBLIC_KEY, ledger_index: 'validated' }]
            })
        });
        const data = await response.json();
        if (data.result) {
             logger.info('Account info fetched successfully.');
            await redis.set(`xrpl:account:${XRPL_PUBLIC_KEY}`, JSON.stringify(data.result));
            logger.info('Stored account info in Redis.');
        } else {
            logger.error('Failed to fetch account info:', data.error_message || data);
        }
    } catch (error) {
        logger.error(`Error fetching account info: ${error.message}`);
    }
}

async function fetchTransactions() {
    try {
        logger.info(`Fetching transactions for: ${XRPL_PUBLIC_KEY}...`);
        const response = await fetch(XRPL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'account_tx',
                params: [{ account: XRPL_PUBLIC_KEY, ledger_index_min: -1, ledger_index_max: -1 }]
            })
        });
        const data = await response.json();
        if (data.result) {
            logger.info('Transactions fetched successfully.');
            await redis.set(`xrpl:tx:${XRPL_PUBLIC_KEY}`, JSON.stringify(data.result));
            logger.info('Stored transactions in Redis.');
        } else {
            logger.error('Failed to fetch transactions:', data.error_message || data);
        }
    } catch (error) {
        logger.error(`Error fetching transactions: ${error.message}`);
    }
}

async function fetchData() {
    try {
        await fetchServerInfo();
        await fetchAccountInfo();
        await fetchTransactions();
        logger.info('XRPL fetcher script completed successfully.');
    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    } finally {
        redis.quit();
    }
}

fetchData();
