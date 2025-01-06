require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchData() {
    try {
        console.log("🚀 Starting automate-fetcher workflow...");

        const apiUrl = process.env.API_URL;

        if (!apiUrl) {
            throw new Error("❌ QUICKSWAP_API is not defined in the .env file");
        }

        console.log(`📡 Fetching data from: ${apiUrl}`);

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: `
                    query {
                        pools {
                            id
                            txCount
                            volumeUSD
                            token0 {
                                id
                                symbol
                                name
                            }
                            token1 {
                                id
                                symbol
                                name
                            }
                            liquidity
                        }
                    }
                `,
            }),
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
        console.error("❌ Error in fetchData:", error);
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

            // Filter logic: Stablecoin pairs AND txCount > 400 OR volumeUSD > 20000
            return (hasStablecoin && txCount > 400) || volumeUSD > 20000;
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
        const pools = await fetchData();

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
        console.error("❌ Error in automateFetcher workflow:", error);
    }
}

automateFetcher();
