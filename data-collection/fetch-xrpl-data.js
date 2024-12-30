const xrpl = require('xrpl');
const logger = require('../monitoring/logger'); // Ensure logger is correctly imported
require('dotenv').config(); // Load environment variables

(async () => {
    try {
        logger.info('Starting XRPL data fetcher...');

        // Fetch WebSocket URLs dynamically from .env
        const mainnetUrl = process.env.XRPL_MAINNET_URL;
        const testnetUrl = process.env.XRPL_TESTNET_URL;

        if (!mainnetUrl || !testnetUrl) {
            throw new Error('Missing XRPL WebSocket URLs in .env file');
        }

        // Connect to XRPL mainnet
        const client = new xrpl.Client(mainnetUrl);
        await client.connect();
        logger.info(`Connected to XRPL Mainnet: ${mainnetUrl}`);

        // Fetch account information or order book data
        const account = process.env.XRPL_ACCOUNT;
        if (!account) {
            throw new Error('Missing XRPL account in .env file');
        }

        const accountInfo = await client.request({
            command: 'account_info',
            account,
            ledger_index: 'validated'
        });

        logger.info(`Fetched account information for ${account}`);
        logger.info(JSON.stringify(accountInfo, null, 2));

        // Fetch order book data (optional example)
        const bookOffers = await client.request({
            command: 'book_offers',
            taker_gets: {
                currency: 'USD',
                issuer: process.env.XRPL_ISSUER
            },
            taker_pays: {
                currency: 'XRP'
            },
            ledger_index: 'validated'
        });

        logger.info('Fetched XRPL order book data');
        logger.info(JSON.stringify(bookOffers, null, 2));

        await client.disconnect();
        logger.info('Disconnected from XRPL Mainnet');
    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    }
})();
