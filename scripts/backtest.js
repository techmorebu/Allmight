const fs = require('fs');
const { logger } = require('../monitoring/logger');
const { generateSignals } = require('../trade-execution/signal-generator');

function backtest() {
    logger.info('--- Starting Backtest ---');

    // Read analyzed trends from the JSON file
    const trendsPath = './logs/analyzed-trends.json';
    if (!fs.existsSync(trendsPath)) {
        logger.error('No trends data file found for backtesting.');
        return;
    }

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));

    if (!trends || Object.keys(trends).length === 0) {
        logger.error('No trends available for backtesting.');
        return;
    }

    const signals = generateSignals(trends);
    logger.info('Generated Signals:', JSON.stringify(signals, null, 2));

    const simulatedResults = [];
    let totalProfit = 0;
    let wins = 0;
    let losses = 0;

    // Simulate trades for each token signal
    for (const [token, signalData] of Object.entries(signals)) {
        const result = simulateTrade(signalData, trends[token]);
        simulatedResults.push({ token, ...result });

        totalProfit += result.profit;
        if (result.profit > 0) wins++;
        if (result.profit < 0) losses++;

        logger.info(`Simulated trade for ${token}: ${JSON.stringify(result, null, 2)}`);
    }

    const winLossRatio = losses > 0 ? (wins / losses).toFixed(2) : 'Infinity';

    const summary = {
        totalTrades: simulatedResults.length,
        wins,
        losses,
        winLossRatio,
        totalProfit,
        averageProfit: simulatedResults.length ? (totalProfit / simulatedResults.length).toFixed(2) : 0,
    };

    logger.info('--- Backtest Summary ---', JSON.stringify(summary, null, 2));

    saveResults(simulatedResults, summary);
    return { simulatedResults, summary };
}

function simulateTrade(signalData, trendData) {
    const { signal, stopLoss, takeProfit } = signalData;
    const entryPrice = trendData.price || 0;

    if (signal === 'Buy') {
        return {
            signal,
            entryPrice,
            profit: entryPrice * 0.05, // Simulated 5% gain
            stopLoss,
            takeProfit,
            timestamp: new Date().toISOString(),
        };
    } else if (signal === 'Sell') {
        return {
            signal,
            entryPrice,
            profit: -entryPrice * 0.05, // Simulated 5% loss
            stopLoss,
            takeProfit,
            timestamp: new Date().toISOString(),
        };
    } else {
        return {
            signal,
            entryPrice,
            profit: 0,
            stopLoss,
            takeProfit,
            timestamp: new Date().toISOString(),
        };
    }
}

function saveResults(results, summary) {
    const logPath = './logs/backtest-results.log';
    const logData = {
        timestamp: new Date().toISOString(),
        results,
        summary,
    };

    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf8');
    logger.info(`Backtest results saved to ${logPath}`);
}

// Main Execution
if (require.main === module) {
    const backtestResults = backtest();
    if (backtestResults) {
        console.log('Backtest Summary:', backtestResults.summary);
    }
}

module.exports = { backtest };
