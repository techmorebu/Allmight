require('dotenv').config();
const xrpl = require('xrpl');
const { logger } = require('../monitoring/logger');

// Fetch environment variables
const XRPL_PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;
const XRPL_PRIVATE_KEY = process.env.XRPL_PRIVATE_KEY;
const XRPL_MAINNET_URL = process.env.XRPL_MAINNET_URL;

if (!XRPL_PUBLIC_KEY || !XRPL_PRIVATE_KEY || !XRPL_MAINNET_URL) {
    logger.error('Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

async function fetchXrplData() {
    try {
        logger.info('Starting XRPL fetcher...');
        
        // Connect to XRPL
        const client = new xrpl.Client(XRPL_MAINNET_URL);
        await client.connect();
        logger.info('Connected to XRPL mainnet.');

        // Fetch account information
        const accountInfo = await client.request({
            command: 'account_info',
            account: XRPL_PUBLIC_KEY,
            ledger_index: 'validated',
        });
        logger.info(`Fetched account info: ${JSON.stringify(accountInfo.result)}`);

        // Fetch account transactions
        const accountTransactions = await client.request({
            command: 'account_tx',
            account: XRPL_PUBLIC_KEY,
            ledger_index_min: -1,
            ledger_index_max: -1,
            limit: 10,
        });
        logger.info(`Fetched account transactions: ${JSON.stringify(accountTransactions.result)}`);

        // Disconnect client
        await client.disconnect();
        logger.info('Disconnected from XRPL mainnet.');

    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    }
}

fetchXrplData();
