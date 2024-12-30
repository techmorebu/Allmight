// Import required modules
const xrpl = require('xrpl');
const dotenv = require('dotenv');
const logger = require('../monitoring/logger');

// Load environment variables
dotenv.config();

const XRPL_MAINNET_URL = process.env.XRPL_MAINNET_URL;
const XRPL_TESTNET_URL = process.env.XRPL_TESTNET_URL;
const XRPL_ACCOUNT = process.env.XRPL_ACCOUNT;
const XRPL_ISSUER = process.env.XRPL_ISSUER;

if (!XRPL_MAINNET_URL || !XRPL_TESTNET_URL || !XRPL_ACCOUNT || !XRPL_ISSUER) {
    logger.error('Missing required environment variables for XRPL configuration.');
    process.exit(1);
}

async function fetchXRPLData() {
    try {
        logger.info('Starting XRPL fetcher script...');

        // Connect to XRPL Mainnet
        const client = new xrpl.Client(XRPL_MAINNET_URL);
        await client.connect();
        logger.info(`Connected to XRPL Mainnet at ${XRPL_MAINNET_URL}`);

        // Fetch account data
        const accountInfo = await client.request({
            command: 'account_info',
            account: XRPL_ACCOUNT,
            ledger_index: 'validated',
        });
        logger.info(`Fetched account data: ${JSON.stringify(accountInfo.result)}`);

        // Fetch order book data
        const orderBook = await client.request({
            command: 'book_offers',
            ledger_index: 'validated',
            taker_gets: {
                currency: 'XRP',
            },
            taker_pays: {
                currency: 'USD',
                issuer: XRPL_ISSUER,
            },
        });
        logger.info(`Fetched order book data: ${JSON.stringify(orderBook.result)}`);

        // Disconnect from XRPL
        await client.disconnect();
        logger.info('Disconnected from XRPL Mainnet.');
    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    }
}

fetchXRPLData();
