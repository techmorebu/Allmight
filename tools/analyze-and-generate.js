require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "../logs");

async function fetchSchemaAndData() {
   const apiUrl = process.env.NEW_DEX_API_URL;
   if (!apiUrl) {
      throw new Error("API URL is not defined in the environment variables.");
   }

   console.log("Using API URL:", apiUrl);

   const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ pools { id volumeUSD txCount } }` }),
   });

   if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
   }

   const rawData = await response.json();
   fs.writeFileSync(path.join(LOGS_DIR, "raw-data.json"), JSON.stringify(rawData, null, 2));
   console.log("✅ Raw data saved to raw-data.json");

   return rawData;
}

async function main() {
   try {
      const rawData = await fetchSchemaAndData();
      console.log("Raw Data Fetched:", JSON.stringify(rawData, null, 2));
   } catch (error) {
      console.error("❌ Error:", error.message);
   }
}

main();
