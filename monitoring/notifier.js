const axios = require('axios');
require('dotenv').config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/**
 * Send a notification to Discord
 * @param {string} message - Notification message
 */
async function sendNotification(message) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('❌ Discord Webhook URL not set. Skipping notification.');
        return;
    }

    try {
        await axios.post(DISCORD_WEBHOOK_URL, { content: message });
        console.log('✅ Notification sent to Discord.');
    } catch (error) {
        console.error('❌ Failed to send Discord notification:', error.message);
    }
}

module.exports = { sendNotification };
