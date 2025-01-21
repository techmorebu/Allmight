// Hybrid Arbitrage System
// Fully integrates Universal Mapper, Cross-Reference Script, and Opportunity Detection

const ethers = require('ethers'); // Explicitly import ethers6 for Hybrid Arbitrage
const ethers67 = require('ethers67'); // Explicitly import ethers67 for Flashbots
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const mapper = require("../tools/universal-field-mapper.js"); // Universal Mapper module
const crossReference = require("../tools/cross-referencing.js"); // Cross-Referencing integration
require('dotenv').config();

const config = {
    dexApis: JSON.parse(process.env.DEX_APIS || '[]'),
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.05'),
};

// Verify Ethers Versions
console.log(`Using ethers version for Hybrid Arbitrage: ${ethers.version}`);
console.log(`Using ethers version for Flashbots: ${ethers67.version}`);

// Run Universal Mapper
async function runMapper() {
    console.log("Initializing Universal Mapper...");
    const outputDir = "../outputs";
    try {
        const result = await mapper.runMapper(outputDir); // Ensure runMapper supports async
        console.log(`Mapping completed. Output saved to: ${outputDir}`);
    } catch (error) {
        console.error("Error running Universal Mapper:", error.message);
    }
}

// Run Cross-Referencing
async function runCrossReference() {
    console.log("Initializing Cross-Referencing...");
    const inputDir = "../outputs"; // Example input directory
    try {
        const result = await crossReference.runCrossReference(inputDir); // Ensure runCrossReference supports async
        console.log("Cross-Referencing Results:", result);
    } catch (error) {
        console.error("Error running Cross-Referencing:", error.message);
    }
}

// Main Workflow
async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL); // Using ethers6 for provider
    const wallet = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, provider); // Using ethers6 for wallet

    console.log("Select an option:");
    console.log("1. Run Universal Mapper");
    console.log("2. Run Cross-Referencing");
    console.log("3. Perform Arbitrage Execution");

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    readline.question("Enter your choice: ", async (choice) => {
        switch (choice) {
            case '1':
                console.log("Running Universal Mapper...");
                await runMapper();
                console.log("Universal Mapper completed.");
                break;

            case '2':
                console.log("Running Cross-Referencing...");
                await runCrossReference();
                console.log("Cross-Referencing completed.");
                break;

            case '3':
                console.log("Starting Arbitrage Execution...");
                await executeArbitrage(provider, wallet);
                console.log("Arbitrage Execution completed.");
                break;

            default:
                console.log("Invalid choice. Exiting.");
        }
        readline.close();
    });
}

// Arbitrage Execution Logic
async function executeArbitrage(provider, wallet) {
    // Fetch data
    const rawData = await fetchDexData();
    if (rawData.length === 0) {
        console.log("No data fetched. Exiting...");
        return;
    }

    // Data Standardization (Universal Mapper)
    const standardizedData = await mapper.mapData(rawData);
    console.log("Data standardized successfully.");

    // Cross-Reference Validation
    try {
        const crossRefResult = await crossReference.validateFields(standardizedData);
        console.log("Cross-referencing validation completed successfully.", crossRefResult);
    } catch (error) {
        console.error("Critical validation error:", error.message);
        return;
    }

    // Opportunity Detection
    const opportunities = detectOpportunities(standardizedData);
    if (opportunities.length === 0) {
        console.log("No profitable opportunities found.");
        return;
    }
    console.log("Detected opportunities:", opportunities);

    // Execution Logic
    for (const opportunity of opportunities) {
        if (opportunity.isFlashbotsReady) {
            const success = await executeViaFlashbots(provider, wallet, opportunity);
            if (!success) {
                console.log("Flashbots execution failed. Retrying in public mempool...");
                await executeInMempool(provider, wallet, opportunity);
            }
        } else {
            await executeInMempool(provider, wallet, opportunity);
        }
    }
}

// Data Fetching
async function fetchDexData() {
    const fetchPromises = config.dexApis.map(api =>
        fetch(api.url)
            .then(res => res.json())
            .catch(err => {
                console.error(`Error fetching data from ${api.name}:`, err.message);
                return null;
            })
    );
    const results = await Promise.all(fetchPromises);
    return results.filter(res => res !== null);
}

// Opportunity Detection
function detectOpportunities(data) {
    const opportunities = [];

    // Spatial Arbitrage
    opportunities.push(...detectSpatialArbitrage(data));

    // Triangular Arbitrage
    opportunities.push(...detectTriangularArbitrage(data));

    // Cross-Chain Arbitrage
    opportunities.push(...detectCrossChainArbitrage(data));

    // Liquidity Arbitrage
    opportunities.push(...detectLiquidityArbitrage(data));

    return opportunities.filter(op => op.netProfit > config.minProfitThreshold);
}

// Execution via Flashbots
async function executeViaFlashbots(provider, wallet, opportunity) {
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet); // Using ethers67 implicitly
    const transactions = createTransactions(opportunity);
    const signedBundle = await flashbotsProvider.signBundle(
        transactions.map(tx => ({ signer: wallet, transaction: tx }))
    );

    const blockNumber = await provider.getBlockNumber();
    const result = await flashbotsProvider.sendBundle(signedBundle, blockNumber + 1);
    if ('error' in result) {
        console.error("Flashbots execution failed:", result.error.message);
        return false;
    }

    console.log("Flashbots execution succeeded.");
    return true;
}

// Execution via Public Mempool
async function executeInMempool(provider, wallet, opportunity) {
    try {
        const transactions = createTransactions(opportunity);
        for (const tx of transactions) {
            const signedTx = await wallet.signTransaction(tx);
            const txReceipt = await provider.sendTransaction(signedTx);
            await txReceipt.wait(1);
            console.log("Transaction confirmed:", txReceipt.hash);
        }
        return true;
    } catch (error) {
        console.error("Public mempool execution failed:", error.message);
        return false;
    }
}

// Create Transactions
function createTransactions(opportunity) {
    // Generate transaction objects for Flash Loan, Trade, and Repayment
    return [
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 },
        { to: opportunity.tradeDex, data: "0x...", value: 0 },
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 },
    ];
}

main();
