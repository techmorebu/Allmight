const mapper = require('../tools/universal-field-mapper.js'); // Universal Mapper module
const crossReference = require('../tools/cross-referencing.js'); // Cross-Referencing module
const arbitrage = require('../scripts/HybridArbitrage.js'); // Hybrid Arbitrage script
const path = require('path');

const outputDir = path.resolve(__dirname, '../outputs'); // Shared output directory

async function runController() {
    console.log('Starting the orchestrated workflow...');
    
    try {
        // Step 1: Run Universal Mapper
        console.log('Running Universal Mapper...');
        const mappedData = await mapper.runMapper(outputDir);
        console.log('Universal Mapper completed.');

        // Step 2: Run Cross-Referencing
        console.log('Running Cross-Referencing...');
        const validatedData = await crossReference.runCrossReference(mappedData);
        console.log('Cross-Referencing completed.');

        // Step 3: Perform Arbitrage Execution
        console.log('Starting Arbitrage Execution...');
        await arbitrage.executeArbitrage(validatedData);
        console.log('Arbitrage Execution completed.');
    } catch (error) {
        console.error('Error in the workflow:', error.message);
    }
}

runController();
