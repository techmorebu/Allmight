const fs = require("fs");
const path = require("path");

// Required fields for the project
const requiredFields = [
  "token0Price",
  "token1Price",
  "volumeUSD",
  "volumeToken0",
  "volumeToken1",
  "liquidity",
  "feesUSD",
  "txCount",
  "tick",
  "tickLower",
  "tickUpper",
  "open",
  "high",
  "low",
  "close",
  "tvlUSD",
  "totalValueLockedUSD",
  "totalValueLockedMatic",
  "volumeUSDUntracked",
  "untrackedFeesUSD",
];

// Scan outputs directory for all field mapping files
const outputsDir = path.join(__dirname, "../outputs");
const fieldFiles = fs.readdirSync(outputsDir).filter((file) => file.endsWith(".json"));

// Helper function to load field mappings from JSON files
function loadApiFields(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data.map((field) => field.name);
  } catch (error) {
    console.error(`Error loading file ${filePath}:`, error.message);
    return [];
  }
}

// Match required fields against API fields
function matchFields(apiFields, requiredFields) {
  const matched = [];
  const missing = [];

  requiredFields.forEach((field) => {
    if (apiFields.includes(field)) {
      matched.push(field);
    } else {
      missing.push(field);
    }
  });

  return { matched, missing };
}

// Generate the cross-reference report
const crossReferenceReport = {};
fieldFiles.forEach((file) => {
  const apiName = path.basename(file, ".json").replace("-fields", "");
  const apiFields = loadApiFields(path.join(outputsDir, file));
  const matches = matchFields(apiFields, requiredFields);

  crossReferenceReport[apiName] = {
    matchedFields: matches.matched,
    missingFields: matches.missing,
  };
});

// Save the report
const reportFilePath = path.join(outputsDir, "field-matching-report.json");
fs.writeFileSync(reportFilePath, JSON.stringify(crossReferenceReport, null, 2));

console.log("Field matching report saved:", reportFilePath);

// Summary output
console.log("\nSummary Report:");
Object.entries(crossReferenceReport).forEach(([apiName, matches]) => {
  console.log(`\nAPI: ${apiName}`);
  console.log(`  Matched fields (${matches.matchedFields.length}):`, matches.matchedFields.join(", "));
  console.log(`  Missing fields (${matches.missingFields.length}):`, matches.missingFields.join(", "));
});
