require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchBalancerData() {
    try {
        console.log("🚀 Starting Balancer fetcher...");

        const apiUrl = process.env.API_URL;

        if (!apiUrl) {
            throw new Error("❌ API_URL is not defined in the .env file");
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
                            liquidity
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
        console.error("❌ Error in fetchBalancerData:", error);
        return [];
    }
}

function filterBalancerPools(pools) {
    try {
        console.log("🔍 Filtering Balancer pools...");
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

            return (
                ((hasStablecoin && txCount > 400) || volumeUSD > 20000) &&
                liquidity > 100000
            );
        });

        console.log(`✅ ${filteredPools.length} pools matched the filter criteria.`);
        return filteredPools;
    } catch (error) {
        console.error("❌ Error in filterBalancerPools:", error);
        return [];
    }
}

async function saveBalancerPools(filteredPools) {
    try {
        const outputPath = "./logs/final-balancer-pools.json";
        fs.writeFileSync(outputPath, JSON.stringify(filteredPools, null, 2));
        console.log(`✅ Filtered Balancer pools saved to ${outputPath}`);
    } catch (error) {
        console.error("❌ Error in saveBalancerPools:", error);
    }
}

async function automateBalancerFetcher() {
    try {
        const pools = await fetchBalancerData();

        if (pools.length === 0) {
            console.log("⚠️ No pools found. Exiting workflow.");
            return;
        }

        const filteredPools = filterBalancerPools(pools);

        if (filteredPools.length === 0) {
            console.log("⚠️ No pools matched the criteria. Exiting workflow.");
            return;
        }

        await saveBalancerPools(filteredPools);

        console.log("🎉 Balancer workflow completed successfully!");
    } catch (error) {
        console.error("❌ Error in automateBalancerFetcher:", error);
    }
}

automateBalancerFetcher();
