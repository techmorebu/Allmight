const winston = require("winston");
const axios = require("axios");
require("dotenv").config(); // Load environment variables

// Create a winston logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "logs/data-collection.log" }),
    ],
});

// Function to send a notification to Discord
async function sendDiscordNotification(message) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        logger.warn("Discord webhook URL is not set in .env.");
        return;
    }

    try {
        await axios.post(webhookUrl, { content: message });
        logger.info("Notification sent to Discord.");
    } catch (error) {
        logger.error(`Error sending Discord notification: ${error.message}`);
    }
}

// Combined logging and notification function
function logAndNotify(level, message) {
    // Log the message using winston
    logger.log({
        level,
        message,
    });

    // Send a notification if the level is 'error' or 'warn'
    if (["error", "warn"].includes(level)) {
        sendDiscordNotification(message);
    }
}

module.exports = { logger, logAndNotify };
