const xrpl = require('xrpl');
require('dotenv').config();

/**
 * Fetch order book data from XRPL DEX.
 * @param {string} currencyPair - The trading pair (e.g., 'XRP/USD').
 * @param {string} network - 'mainnet' or 'testnet'.
 */
async function fetchXrplOrderBook(currencyPair, network = 'testnet') {
    const server = network === 'mainnet' ? process.env.XRPL_MAINNET_URL : process.env.XRPL_TESTNET_URL;
    const client = new xrpl.Client(server);

    try {
        await client.connect();

        const [base, counter] = currencyPair.split('/');

        // Fetch the order book
        const orderBook = await client.request({
            command: 'book_offers',
            taker_gets: { currency: base },
            taker_pays: { currency: counter }
        });

        console.log(`Order Book for ${currencyPair} on ${network}:`, orderBook.result.offers);
        return orderBook.result.offers;
    } catch (error) {
        console.error(`Error fetching XRPL order book for ${currencyPair}:`, error.message);
        throw error;
    } finally {
        await client.disconnect();
    }
}

module.exports = { fetchXrplOrderBook };
