require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

async function fetchPools() {
    try {
        console.log("🚀 Starting automate-fetcher workflow...");

        const apiUrl = process.env.API_URL;

        if (!apiUrl) {
            throw new Error("❌ API_URL is not defined in the .env file");
        }

        console.log(`📡 Fetching data from: ${apiUrl}`);

        const query = fs.readFileSync(path.join(__dirname, "../logs/generated-query.graphql"), "utf-8");

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.errors) {
            console.error("❌ Errors in API response:", data.errors);
            return [];
        }

        const pools = data.data.pools || [];
        console.log("✅ Raw data fetched successfully.");
        return pools;
    } catch (error) {
        console.error("❌ Error in fetchPools:", error);
        return [];
    }
}

function filterPools(pools) {
    try {
        console.log("🔍 Filtering pools...");
        const filteredPools = pools.filter(pool => {
            const token0 = pool.token0 || {};
            const token1 = pool.token1 || {};

            const token0Symbol = token0.symbol || "UNKNOWN";
            const token1Symbol = token1.symbol || "UNKNOWN";

            const hasStablecoin =
                ["DAI", "USDC", "USDT"].includes(token0Symbol) ||
                ["DAI", "USDC", "USDT"].includes(token1Symbol);
            const txCount = pool.txCount ? parseInt(pool.txCount, 10) : 0;
            const volumeUSD = pool.volumeUSD ? parseFloat(pool.volumeUSD) : 0;
            const liquidity = pool.liquidity ? parseFloat(pool.liquidity) : 0;

            // Filter logic: Stablecoin pairs AND txCount > 400 OR volumeUSD > 20000, liquidity > 100000
            return (
                ((hasStablecoin && txCount > 400) || volumeUSD > 20000) &&
                liquidity > 100000
            );
        });

        console.log(`✅ ${filteredPools.length} pools matched the filter criteria.`);
        return filteredPools;
    } catch (error) {
        console.error("❌ Error in filterPools:", error);
        return [];
    }
}

async function saveFilteredPools(filteredPools) {
    try {
        const outputPath = "./logs/final-pools.json";
        fs.writeFileSync(outputPath, JSON.stringify(filteredPools, null, 2));
        console.log(`✅ Filtered pools saved to ${outputPath}`);
    } catch (error) {
        console.error("❌ Error in saveFilteredPools:", error);
    }
}

async function automateFetcher() {
    try {
        console.log("📊 Running schema analysis...");
        const analyzeScript = path.join(__dirname, "analyze-and-generate.js");

        const analyzeResult = require("child_process").execSync(`node ${analyzeScript}`).toString();
        console.log(analyzeResult);

        console.log("📡 Running data fetcher...");
        const pools = await fetchPools();

        if (pools.length === 0) {
            console.log("⚠️ No pools found. Exiting workflow.");
            return;
        }

        const filteredPools = filterPools(pools);

        if (filteredPools.length === 0) {
            console.log("⚠️ No pools matched the criteria. Exiting workflow.");
            return;
        }

        await saveFilteredPools(filteredPools);

        console.log("🎉 Workflow completed successfully!");
    } catch (error) {
        console.error("❌ Error in automate-fetcher workflow:", error);
    }
}

automateFetcher();
