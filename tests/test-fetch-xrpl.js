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
        logger.info('Starting XRPL fetcher test...');
        logger.debug(`Using XRPL_PUBLIC_KEY: ${XRPL_PUBLIC_KEY}`);
        logger.debug(`Using XRPL_MAINNET_URL: ${XRPL_MAINNET_URL}`);

        // Connect to XRPL
        logger.info('Connecting to XRPL mainnet...');
        const client = new xrpl.Client(XRPL_MAINNET_URL);
        await client.connect();
        logger.info('Successfully connected to XRPL mainnet.');

        // Fetch account information
        logger.info(`Fetching account info for public key: ${XRPL_PUBLIC_KEY}`);
        const accountInfo = await client.request({
            command: 'account_info',
            account: XRPL_PUBLIC_KEY,
            ledger_index: 'validated',
        });
        logger.debug(`Raw account info response: ${JSON.stringify(accountInfo)}`);
        logger.info(`Fetched account info: ${JSON.stringify(accountInfo.result.account_data)}`);

        // Fetch account transactions
        logger.info(`Fetching transactions for account: ${XRPL_PUBLIC_KEY}`);
        const accountTransactions = await client.request({
            command: 'account_tx',
            account: XRPL_PUBLIC_KEY,
            ledger_index_min: -1,
            ledger_index_max: -1,
            limit: 10,
        });
        logger.debug(`Raw transactions response: ${JSON.stringify(accountTransactions)}`);
        logger.info(`Fetched transactions: ${accountTransactions.result.transactions.length} transactions retrieved.`);

        // Validation Function
        validateXrplData(accountInfo.result, accountTransactions.result);

        // Disconnect client
        logger.info('Disconnecting from XRPL mainnet...');
        await client.disconnect();
        logger.info('Disconnected from XRPL mainnet.');
    } catch (error) {
        logger.error(`Error in XRPL fetcher test script: ${error.message}`);
        logger.debug(`Stack trace: ${error.stack}`);
    }
}

function validateXrplData(accountInfo, accountTransactions) {
    try {
        logger.info('Starting XRPL data validation...');

        // Validate account info
        logger.debug('Validating account info...');
        if (!accountInfo.account_data || accountInfo.account_data.Account !== XRPL_PUBLIC_KEY) {
            throw new Error('Invalid or mismatched account information.');
        }
        logger.info('Account info validated successfully.');

        // Validate transactions
        logger.debug('Validating transactions...');
        if (!Array.isArray(accountTransactions.transactions)) {
            throw new Error('Invalid transaction format.');
        }
        logger.info('Transaction data validated successfully.');

        // Check if at least one transaction exists
        if (accountTransactions.transactions.length === 0) {
            logger.warn('No transactions found for the account.');
        } else {
            logger.info(`Validated ${accountTransactions.transactions.length} transactions.`);
        }

        logger.info('XRPL data validation completed successfully.');
    } catch (error) {
        logger.error(`Error during validation: ${error.message}`);
        logger.debug(`Validation error details: ${JSON.stringify(error)}`);
    }
}

// Run the fetch and validation
fetchXrplData();
