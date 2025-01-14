const ethers67 = require('ethers67'); // Alias for ethers@6.7.1
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const universalMapper = require('./universal-field-mapper'); // Universal Mapper
const crossReference = require('./cross-referencing'); // Cross-Reference Script
const config = require('./config');

// Verify the ethers version
console.log(`Using ethers67 version: ${ethers67.version}`);

// Main Workflow
async function main() {
    const provider = new ethers67.JsonRpcProvider(process.env.ETH_RPC_URL);
    const wallet = new ethers67.Wallet(process.env.PRIVATE_KEY, provider);

    // Step 1: Data Fetching
    const rawData = await fetchDexData();
    if (rawData.length === 0) {
        console.log("No data fetched. Exiting...");
        return;
    }

    // Step 2: Data Standardization (Universal Mapper)
    const standardizedData = universalMapper.mapData(rawData);
    console.log("Data standardized successfully.");

    // Step 3: Cross-Referencing Validation
    try {
        const crossRefReport = await validateWithCrossReference(standardizedData);
    } catch (error) {
        console.error("Critical validation error:", error.message);
        return;
    }

    // Step 4: Opportunity Detection
    const opportunities = detectOpportunities(standardizedData);
    if (opportunities.length === 0) {
        console.log("No profitable opportunities found.");
        return;
    }
    console.log("Detected opportunities:", opportunities);

    // Step 5: Execution Logic
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

    console.log("Arbitrage execution completed.");
}

// Flashbots Execution
async function executeViaFlashbots(provider, wallet, opportunity) {
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet);
    const transactions = createTransactions(opportunity);
    const signedBundle = await flashbotsProvider.signBundle(
        transactions.map(tx => ({ signer: wallet, transaction: tx }))
    );

    const blockNumber = await provider.getBlockNumber();
    const result = await flashbotsProvider.sendBundle(signedBundle, blockNumber + 1);
    if ("error" in result) {
        console.error("Flashbots execution failed:", result.error.message);
        return false;
    }

    console.log("Flashbots execution succeeded.");
    return true;
}

// Public Mempool Execution
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

// Helper Functions
function createTransactions(opportunity) {
    return [
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 },
        { to: opportunity.tradeDex, data: "0x...", value: 0 },
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 }
    ];
}

// Data Fetching
async function fetchDexData() {
    const fetchPromises = config.dexApis.map(api => fetch(api.url).then(res => res.json()).catch(err => null));
    const results = await Promise.all(fetchPromises);
    return results.filter(res => res !== null);
}

// Opportunity Detection
function detectOpportunities(data) {
    const opportunities = [];
    opportunities.push(...detectSpatialArbitrage(data));
    opportunities.push(...detectTriangularArbitrage(data));
    opportunities.push(...detectCrossChainArbitrage(data));
    opportunities.push(...detectLiquidityArbitrage(data));
    return opportunities.filter(op => op.netProfit > config.minProfitThreshold);
}

main();
