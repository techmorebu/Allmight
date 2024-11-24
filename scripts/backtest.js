const fs = require('fs');

function backtestTradeLog() {
  const filePath = '/home/techbu/OFA_Project_Local/ofa-project/logs/trade-log.json';
  const historicalDataPath = '/home/techbu/OFA_Project_Local/ofa-project/logs/historical-data.json';

  if (!fs.existsSync(filePath) || !fs.existsSync(historicalDataPath)) {
    console.error('Trade log or historical data file not found.');
    return;
  }

  const tradeLog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const historicalData = JSON.parse(fs.readFileSync(historicalDataPath, 'utf8'));

  console.log('--- Backtesting Trades ---');
  let successCount = 0;

  tradeLog.forEach(trade => {
    const matchingData = historicalData.find(data =>
      new Date(data.timestamp).getTime() >= new Date(trade.timestamp).getTime()
    );

    if (matchingData) {
      const priceChange = matchingData.ethPrice - trade.priceAtSignal;
      if (
        (trade.signal === 'Buy' && priceChange > 0) ||
        (trade.signal === 'Sell' && priceChange < 0)
      ) {
        console.log(`✅ Successful ${trade.signal} trade.`);
        successCount++;
      } else {
        console.log(`❌ Failed ${trade.signal} trade.`);
      }
    }
  });

  console.log(`Total Trades: ${tradeLog.length}`);
  console.log(`Successful Trades: ${successCount}`);
  console.log(`Success Rate: ${(successCount / tradeLog.length) * 100}%`);
}

backtestTradeLog();
