require("dotenv").config();
const xrpl = require("xrpl");
const { logger } = require("../monitoring/logger");

(async () => {
  try {
    // Load keys and URLs from .env
    const XRPL_URL = process.env.XRPL_MAINNET_URL;
    const PUBLIC_KEY = process.env.XRPL_PUBLIC_KEY;
    const PRIVATE_KEY = process.env.XRPL_PRIVATE_KEY;

    if (!XRPL_URL || !PUBLIC_KEY || !PRIVATE_KEY) {
      throw new Error("Missing XRPL configuration in .env");
    }

    // Connect to XRPL client
    const client = new xrpl.Client(XRPL_URL);
    await client.connect();
    logger.info("Connected to XRPL");

    // Generate wallet from keys
    const wallet = xrpl.Wallet.fromSeed(PRIVATE_KEY);

    if (wallet.classicAddress !== PUBLIC_KEY) {
      throw new Error(
        `Public key mismatch. Wallet derived address: ${wallet.classicAddress}`
      );
    }
    logger.info(`Using wallet with address: ${wallet.classicAddress}`);

    // Fetch account information
    const accountInfo = await client.request({
      command: "account_info",
      account: wallet.classicAddress,
      ledger_index: "validated",
    });

    logger.info("Account Info:", accountInfo.result);

    // Fetch account transactions
    const transactions = await client.request({
      command: "account_tx",
      account: wallet.classicAddress,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 10,
    });

    logger.info("Recent Transactions:", transactions.result.transactions);

    // Fetch order book data
    const orderBook = await client.request({
      command: "book_offers",
      taker_gets: {
        currency: "USD",
        issuer: "rEXAMPLEISSUERADDRESS", // Replace with your issuer address
      },
      taker_pays: {
        currency: "XRP",
      },
      ledger_index: "validated",
    });

    logger.info("Order Book:", orderBook.result.offers);

    // Example: Signing and submitting a payment transaction
    const preparedPayment = await client.autofill({
      TransactionType: "Payment",
      Account: wallet.classicAddress,
      Amount: xrpl.xrpToDrops("10"), // 10 XRP
      Destination: "rEXAMPLEDESTINATIONADDRESS", // Replace with destination address
    });

    logger.info("Prepared Transaction:", preparedPayment);

    const signedPayment = wallet.sign(preparedPayment);
    logger.info("Signed Transaction:", signedPayment);

    const paymentResult = await client.submitAndWait(signedPayment.tx_blob);
    logger.info("Payment Transaction Result:", paymentResult.result);

    // Close connection
    await client.disconnect();
    logger.info("Disconnected from XRPL");
  } catch (error) {
    logger.error(`Error in XRPL fetcher script: ${error.message}`);
    process.exit(1);
  }
})();
