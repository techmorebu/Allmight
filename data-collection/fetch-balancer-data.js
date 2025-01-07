require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

const balancerApis = [
    { name: "Polygon", url: process.env.BALANCER_POLYGON_API },
    { name: "Optimism", url: process.env.BALANCER_OPTIMISIM_API },
    { name: "Arbitrum", url: process.env.BALANCER_ARBITRUM_API },
    { name: "Avalanche", url: process.env.BALANCER_AVALANCHE_API },
    { name: "Ethereum", url: process.env.BALANCER_ETHEREUM_API },
];

async function fetchBalancerData(api) {
    try {
        console.log(`🚀 Fetching data from Balancer (${api.name})...`);

        const response = await fetch(api.url, {
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
            console.error(`❌ Errors in API response (${api.name}):`, data.errors);
            return [];
        }

        const pools = data.data.pools || [];
        console.log(`✅ Fetched ${pools.length} pools from Balancer (${api.name}).`);
        return pools;
    } catch (error) {
        console.error(`❌ Error fetching data from Balancer (${api.name}):`, error);
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

async function saveConsolidatedData(data) {
    try {
        const outputPath = "./logs/consolidated-balancer-pools.json";
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`✅ Consolidated data saved to ${outputPath}`);
    } catch (error) {
        console.error("❌ Error saving consolidated data:", error);
    }
}

async function automateBalancerFetcher() {
    const consolidatedData = {};

    for (const api of balancerApis) {
        if (!api.url) {
            console.warn(`⚠️ API URL for ${api.name} is missing. Skipping...`);
            continue;
        }

        const pools = await fetchBalancerData(api);

        if (pools.length === 0) {
            console.log(`⚠️ No pools found for ${api.name}. Skipping...`);
            continue;
        }

        const filteredPools = filterBalancerPools(pools);

        if (filteredPools.length === 0) {
            console.log(`⚠️ No pools matched the criteria for ${api.name}. Skipping...`);
            continue;
        }

        // Add filtered pools to consolidated data
        consolidatedData[api.name] = filteredPools;
    }

    await saveConsolidatedData(consolidatedData);
    console.log("🎉 Balancer workflow completed for all networks!");
}

automateBalancerFetcher();
