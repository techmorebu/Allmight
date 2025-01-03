// fetch-xrpl-data.js
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const XRPL_MAINNET_URL = process.env.XRPL_MAINNET_URL;

if (!XRPL_MAINNET_URL) {
    logger.error("Missing XRPL_MAINNET_URL in .env file. Please provide a valid WebSocket URL.");
    process.exit(1);
}

(async () => {
    logger.info("Starting XRPL fetcher script...");

    try {
        logger.info(`Connecting to XRPL mainnet at ${XRPL_MAINNET_URL}...`);
        const ws = new WebSocket(XRPL_MAINNET_URL);

        ws.on('open', () => {
            logger.info("Successfully connected to XRPL mainnet.");
            // Send a test command to fetch server information
            const serverInfoCommand = JSON.stringify({ id: 1, command: 'server_info' });
            ws.send(serverInfoCommand);
            logger.info("Sent server_info command to XRPL.");
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            logger.info("Received message from XRPL:");
            logger.debug(JSON.stringify(message, null, 2));
        });

        ws.on('close', () => {
            logger.warn("WebSocket connection to XRPL closed.");
        });

        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
        });

    } catch (error) {
        logger.error(`Error in XRPL fetcher script: ${error.message}`);
    }
})();
