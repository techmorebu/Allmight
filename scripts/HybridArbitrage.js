// Hybrid Arbitrage System
// Fully integrates Universal Mapper, Cross-Reference Script, and Opportunity Detection

const ethers = require('ethers'); // Explicitly import ethers6
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const universalMapper = require("./universal-field-mapper"); // Universal Mapper module
const crossReference = require("./cross-referencing"); // Optimized Cross-Reference Script
const config = require("./config");

// Verify Ethers Version
console.log(`Using ethers version: ${ethers.version}`);

// Optimized Cross-Referencing Validation with Error Thresholds
async function validateWithCrossReference(data) {
    console.log("Starting cross-referencing validation...");

    // Use fixed required fields
    const requiredFields = [
        "token0Price", "token1Price", "volumeUSD", "feesUSD", "liquidity",
        "txCount", "open", "high", "low", "close", "totalValueLockedUSD"
    ];

    const maxAllowedMissingFields = parseInt(process.env.MAX_ALLOWED_MISSING_FIELDS || "3", 10);

    const validationResult = crossReference.validateFields(data, requiredFields);

    // Enhanced Logging
    if (validationResult.missing.length > 0) {
        console.warn("Validation warnings: Missing fields detected:", validationResult.missing);
    }

    console.info("Cross-referencing validation completed successfully.", {
        matchedFields: validationResult.matched.length,
        missingFields: validationResult.missing.length,
    });

    // Fail-safe for critical missing fields
    if (validationResult.missing.length > maxAllowedMissingFields) {
        throw new Error(`Validation failed: Too many missing fields (${validationResult.missing.length}). Maximum allowed: ${maxAllowedMissingFields}`);
    }

    return validationResult;
}

// Main Workflow
async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Step 1: Data Fetching
    const rawData = await fetchDexData();
    if (rawData.length === 0) {
        console.log("No data fetched. Exiting...");
        return;
    }

    // Step 2: Data Standardization (Universal Mapper)
    const standardizedData = universalMapper.mapData(rawData);
    console.log("Data standardized successfully.");

    // Step 3: Cross-Referencing Validation (Optimized)
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

// Data Fetching
async function fetchDexData() {
    const fetchPromises = config.dexApis.map(api => fetch(api.url).then(res => res.json()).catch(err => null));
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
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 }, // Flash loan transaction
        { to: opportunity.tradeDex, data: "0x...", value: 0 }, // Trade transaction
        { to: opportunity.flashLoanProvider, data: "0x...", value: 0 } // Repayment transaction
    ];
}

main();
