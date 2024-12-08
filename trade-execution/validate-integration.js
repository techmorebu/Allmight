const { runDataPipeline } = require('./data-pipeline'); // Adjust if needed
const { generateSignals } = require('./signal-generator'); // Adjust if needed
const { runLiveTrading } = require('./trade-live'); // Adjust if needed

async function validateIntegration() {
  try {
    console.log('--- Starting Integration Validation ---');

    // Step 1: Test Data Pipeline
    console.log('Running data pipeline...');
    await runDataPipeline();
    console.log('Data pipeline completed successfully.');

    // Step 2: Test Signal Generator
    console.log('Generating signals...');
    const trendsPath = '../logs/trends-log.json';
    const trends = require(trendsPath);
    const signals = await generateSignals(trends);
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
