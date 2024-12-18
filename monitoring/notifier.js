const axios = require('axios');
require('dotenv').config();

const GENERAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PROFIT_WEBHOOK_URL = process.env.DISCORD_PROFIT_WEBHOOK_URL;

/**
 * Send a general notification to Discord
 * @param {string} message - Notification message
 */
async function sendGeneralNotification(message) {
    if (!GENERAL_WEBHOOK_URL) {
        console.warn('❌ General Discord Webhook URL not set. Skipping notification.');
        return;
    }

    try {
        await axios.post(GENERAL_WEBHOOK_URL, { content: message });
        console.log('✅ General notification sent to Discord.');
    } catch (error) {
        console.error('❌ Failed to send general Discord notification:', error.message);
    }
}

/**
 * Send a profit notification to Discord
 * @param {string} message - Notification message
 */
async function sendProfitNotification(message) {
    if (!PROFIT_WEBHOOK_URL) {
        console.warn('❌ Profit Discord Webhook URL not set. Skipping profit notification.');
        return;
    }

    try {
        await axios.post(PROFIT_WEBHOOK_URL, { content: message });
        console.log('✅ Profit notification sent to Discord.');
    } catch (error) {
        console.error('❌ Failed to send profit Discord notification:', error.message);
    }
}

module.exports = { sendGeneralNotification, sendProfitNotification };
