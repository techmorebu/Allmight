// Import dependencies
const xrpl = require("xrpl");
const logger = require("../monitoring/logger");

// Fetch XRPL data
const fetchXRPLData = async () => {
  try {
    logger.info("Starting XRPL data fetch...");

    // Create a client and connect to XRPL mainnet
    const client = new xrpl.Client("wss://s1.ripple.com");
    await client.connect();

    logger.info("Connected to XRPL mainnet.");

    // Example: Fetch account info (replace with your desired functionality)
    const account = "rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; // Replace with a real XRPL address
    const accountInfo = await client.request({
      command: "account_info",
      account,
      ledger_index: "validated",
    });

    logger.info(`Fetched account info: ${JSON.stringify(accountInfo.result)}`);

    // Disconnect the client
    await client.disconnect();
    logger.info("Disconnected from XRPL mainnet.");
  } catch (error) {
    logger.error(`Error in XRPL fetcher script: ${error.message}`);
  }
};

// Run the fetcher
fetchXRPLData();
