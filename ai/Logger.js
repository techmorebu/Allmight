const fs = require('fs');

function logTrade(action, details) {
    const logEntry = `${new Date().toISOString()} - ${action}: ${JSON.stringify(details)}\n`;
    fs.appendFileSync('trade_log.txt', logEntry, 'utf8');
    console.log(logEntry);
}

module.exports = { logTrade };
