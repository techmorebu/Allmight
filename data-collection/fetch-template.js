require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchData() {
    const apiUrl = process.env.API_URL;
    const dexName = process.env.DEX_NAME || "unknown-dex";

    if (!apiUrl) {
        throw new Error("❌ API_URL is not defined in the .env file");
    }

    const queryPath = `./logs/generated-query-${dexName}.graphql`;
    if (!fs.existsSync(queryPath)) {
        throw new Error(`❌ GraphQL query file not found for ${dexName}. Run analyze-and-generate.js first.`);
    }

    const query = fs.readFileSync(queryPath, "utf8");

    console.log(`🚀 Fetching data for ${dexName} from: ${apiUrl}`);
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        throw new Error(`❌ Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
        console.error(`❌ Errors in API response for ${dexName}:`, data.errors);
        return [];
    }

    return data.data.pools || [];
}

async function filterAndSavePools(pools) {
    const filteredPools = pools.filter(pool => {
        const txCount = parseInt(pool.txCount || "0", 10);
        const volumeUSD = parseFloat(pool.volumeUSD || "0");
        const liquidity = parseFloat(pool.liquidity || "0");

        return (txCount > 400 && volumeUSD > 20000 && liquidity > 100000);
    });

    const outputPath = `./logs/final-pools-${process.env.DEX_NAME}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(filteredPools, null, 2));
    console.log(`✅ Filtered pools saved to ${outputPath}`);
}

(async () => {
    try {
        const pools = await fetchData();
        if (pools.length === 0) {
            console.log("⚠️ No pools found. Exiting.");
            return;
        }

        await filterAndSavePools(pools);
        console.log("🎉 Fetcher workflow completed successfully!");
    } catch (error) {
        console.error("❌ Error in fetcher workflow:", error);
    }
})();
