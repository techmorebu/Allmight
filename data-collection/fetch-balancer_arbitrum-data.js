
require("dotenv").config();
const fetch = require("node-fetch");

(async function fetchData() {
    try {
        console.log("🚀 Fetching data for Balancer_Arbitrum...");
        const response = await fetch("https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/98cQDy6tufTJtshDCuhh9z2kWXsQWBHVh2bqnLHsGAeS", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: `
                    query {
                        pools { id volumeUSD txCount liquidity token0 { symbol } token1 { symbol } }
                    }
                `,
            }),
        });

        const data = await response.json();
        if (data.errors) {
            console.error("❌ Errors in API response:", data.errors);
        } else {
            console.log("✅ Data fetched successfully:", data.data);
        }
    } catch (error) {
        console.error("❌ Error fetching data for Balancer_Arbitrum:", error);
    }
})();
