
require("dotenv").config();
const fetch = require("node-fetch");

(async function fetchData() {
    try {
        console.log("🚀 Fetching data for Balancer_Polygon...");
        const response = await fetch("https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp", {
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
        console.error("❌ Error fetching data for Balancer_Polygon:", error);
    }
})();
