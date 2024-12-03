const winston = require('winston');
const axios = require('axios');

// Discord webhook URL from .env
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Create the logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/data-collection.log' }),
    ],
});

// Function to log and notify
async function logAndNotify(level, message) {
    logger.log({ level, message });

    // Send notifications only for 'error' or 'warn'
    if (level === 'error' || level === 'warn') {
        if (DISCORD_WEBHOOK_URL) {
            try {
                await axios.post(DISCORD_WEBHOOK_URL, { content: message });
                logger.info('Notification sent to Discord.');
            } catch (error) {
                logger.warn(`Failed to send Discord notification: ${error.message}`);
            }
        } else {
            logger.warn('Discord webhook URL not set. Notification skipped.');
        }
    }
}

module.exports = { logger, logAndNotify };
