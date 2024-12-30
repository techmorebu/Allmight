const xrpl = require('xrpl');
const Redis = require('ioredis');
const logger = require('../monitoring/logger'); // Ensure logger is consistent with the project setup

// Initialize Redis client
const redis = new Redis();

async function fetchOrderBook(client, pair) {
    try {
        const response = await client.request({
            command: 'book_offers',
            taker_gets: pair.base,
            taker_pays: pair.quote
        });
        await redis.set(`xrpl:orderbook:${pair.id}`, JSON.stringify(response));
        logger.info(`Order book data stored for pair: ${pair.id}`);
    } catch (error) {
        logger.error(`Error fetching order book for pair ${pair.id}: ${error.message}`);
    }
}

async function fetchTradeHistory(client, pair) {
    try {
        const response = await client.request({
            command: 'account_tx',
            account: pair.issuer,
            ledger_index_min: -1,
            ledger_index_max: -1,
            binary: false,
            limit: 10
        });
        await redis.set(`xrpl:trades:${pair.id}`, JSON.stringify(response.transactions));
        logger.info(`Trade history stored for pair: ${pair.id}`);
    } catch (error) {
        logger.error(`Error fetching trade history for pair ${pair.id}: ${error.message}`);
    }
}

async function fetchWalletBalances(client, walletAddress) {
    try {
        const response = await client.request({
            command: 'account_lines',
            account: walletAddress
        });
        await redis.set(`xrpl:wallet:${walletAddress}`, JSON.stringify(response.lines));
        logger.info(`Wallet balances stored for address: ${walletAddress}`);
    } catch (error) {
        logger.error(`Error fetching wallet balances for address ${walletAddress}: ${error.message}`);
    }
}

async function main() {
    const client = new xrpl.Client('wss://s1.ripple.com'); // Connect to mainnet
    await client.connect();

    const pairs = [
        {
            id: 'XRP/USD',
            base: { currency: 'XRP' },
            quote: { currency: 'USD', issuer: 'rExampleIssuerAddress...' }
        }
    ];

    for (const pair of pairs) {
        await fetchOrderBook(client, pair);
        await fetchTradeHistory(client, pair);
    }

    const walletAddress = 'rExampleWalletAddress...';
    await fetchWalletBalances(client, walletAddress);

    await client.disconnect();
    redis.quit();
    logger.info('XRPL fetcher completed successfully.');
}

main().catch((error) => {
    logger.error(`Error in XRPL fetcher script: ${error.message}`);
});
