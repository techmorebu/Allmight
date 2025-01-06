// Update fetcher script dynamically based on DEX
function updateFetcherScript(dexName, generatedQuery) {
    try {
        console.log("🔄 Updating fetcher script...");
        
        const fetcherPath = path.join(__dirname, `../data-collection/fetch-${dexName}-data.js`);
        
        if (!fs.existsSync(fetcherPath)) {
            throw new Error(`❌ Fetcher script not found: ${fetcherPath}`);
        }

        const fetcherContent = fs.readFileSync(fetcherPath, "utf-8");
        const updatedContent = fetcherContent.replace(
            /query\s+\{([\s\S]*?)\}/g,
            generatedQuery.trim()
        );

        fs.writeFileSync(fetcherPath, updatedContent);
        console.log(`✅ Fetcher script updated: ${fetcherPath}`);
    } catch (error) {
        console.error("❌ Error updating fetcher script:", error);
        throw error;
    }
}

// Main execution with dynamic DEX handling
(async () => {
    try {
        const apiUrl = process.env.API_URL;
        const dexName = process.env.DEX_NAME || "unknown-dex";

        if (!apiUrl) {
            throw new Error("❌ API_URL is not defined in the .env file");
        }

        console.log(`🚀 Processing DEX: ${dexName}`);

        const schemaTypes = await fetchSchema(apiUrl);
        fs.writeFileSync(`./logs/raw-schema-${dexName}.json`, JSON.stringify(schemaTypes, null, 2));
        console.log(`✅ Raw schema saved to logs/raw-schema-${dexName}.json`);

        const fields = analyzeFields(schemaTypes);
        fs.writeFileSync(`./logs/field-analysis-${dexName}.json`, JSON.stringify(fields, null, 2));
        console.log(`✅ Field analysis saved to logs/field-analysis-${dexName}.json`);

        const generatedQuery = generateQuery(fields);
        fs.writeFileSync(`./logs/generated-query-${dexName}.graphql`, generatedQuery);
        console.log(`✅ Generated query saved to logs/generated-query-${dexName}.graphql`);

        updateFetcherScript(dexName, generatedQuery);

        console.log("🎉 Schema analysis and fetcher update completed successfully!");
    } catch (error) {
        console.error("❌ Error in analyze-and-generate.js:", error);
    }
})();
