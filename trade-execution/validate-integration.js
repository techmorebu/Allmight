const { runDataPipeline } = require('./data-pipeline');
const { generateSignals } = require('./signal-generator');
const { runLiveTrading } = require('./trade-live');
const fs = require('fs');
const path = require('path');

async function validateIntegration() {
  try {
    console.log('--- Starting Integration Validation ---');

    // Step 1: Test Data Pipeline
    console.log('Running data pipeline...');
    await runDataPipeline();
    console.log('Data pipeline completed successfully.');

    // Step 2: Test Signal Generator
    console.log('Generating signals...');
    const trendsPath = path.resolve(__dirname, './logs/trends-log.json');
    if (!fs.existsSync(trendsPath)) {
      throw new Error('Trends log file not found. Ensure the data pipeline generated trends-log.json.');
    }

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));
    const signals = await generateSignals(trends);
    if (!signals || Object.keys(signals).length === 0) {
      throw new Error('No signals generated. Aborting validation.');
    }
    console.log('Signals generated successfully:', signals);

    // Step 3: Test Live Trading
    console.log('Executing live trading...');
    await runLiveTrading();
    console.log('Live trading completed successfully.');

    console.log('--- Integration Validation Successful ---');
  } catch (error) {
    console.error('Integration Validation Failed:', error.message);
  }
}

validateIntegration();
