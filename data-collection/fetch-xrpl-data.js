const xrpl = require('xrpl');
const logger = require('../monitoring/logger.js');

async function fetchXRPLData() {
  try {
    logger.info('Starting XRPL data fetch...');
    const client = new xrpl.Client('wss://s1.ripple.com');
    await client.connect();

    // Fetch account information
    const account = 'rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const accountInfo = await client.request({
      command: 'account_info',
      account: account,
    });

    logger.info(`Fetched account info: ${JSON.stringify(accountInfo.result)}`);

    // Fetch order book data (example)
    const orderBookData = await client.request({
      command: 'book_offers',
      taker: 'rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      taker_gets: {
        currency: 'XRP',
      },
      taker_pays: {
        currency: 'USD',
        issuer: 'rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      },
    });

    logger.info(`Fetched order book data: ${JSON.stringify(orderBookData.result)}`);
    await client.disconnect();
    logger.info('XRPL data fetch completed successfully.');
  } catch (error) {
    logger.error(`Error in XRPL fetcher script: ${error.message}`);
  }
}

fetchXRPLData();
