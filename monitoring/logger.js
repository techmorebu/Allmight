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
        new winston.transports.Console({
            handleExceptions: true,
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
        new winston.transports.File({
            filename: 'logs/data-collection.log',
            handleExceptions: true,
            maxsize: 5242880, // 5MB
            maxFiles: 5, // Keep last 5 logs
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: 'logs/exceptions.log',
        }),
    ],
    exitOnError: false,
});

// Function to log and notify
async function logAndNotify(level, message) {
    logger.log({ level, message });

    // Send notifications only for 'error' or 'warn'
    if (['error', 'warn'].includes(level)) {
        if (DISCORD_WEBHOOK_URL) {
            try {
                await axios.post(DISCORD_WEBHOOK_URL, {
                    content: `[${level.toUpperCase()}] ${message}`,
                });
                logger.info('Notification sent to Discord.');
            } catch (error) {
                logger.warn(`Failed to send Discord notification: ${error.message}`);
            }
        } else {
            logger.warn('Discord webhook URL not set. Notification skipped.');
        }
    }
}

// Exported functions
module.exports = { logger, logAndNotify };

// Test Example
if (require.main === module) {
    logger.info('This is an info log.');
    logger.warn('This is a warning log.');
    logger.error('This is an error log.');

    // Test notification
    logAndNotify('error', 'This is a test error notification.');
}
