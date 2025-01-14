const fs = require("fs");
const path = require("path");

// Directories for outputs and debug logs
const outputsDir = path.resolve(__dirname, "../outputs");
const debugDir = path.join(outputsDir, "debug");
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

const debugFilePath = path.join(debugDir, "chatcrossdebug.json");
const debugOutput = [];

// Required fields
const requiredFields = { name: "token0Price", description: "Price of the first token in the pair" },
  { name: "token1Price", description: "Price of the second token in the pair" },
  { name: "volumeUSD", description: "Total trading volume in USD" },
  { name: "feesUSD", description: "Total fees generated in USD" },
  { name: "liquidity", description: "Current pool liquidity" },
  { name: "txCount", description: "Transaction count" },
  { name: "open", description: "Opening price" },
  { name: "high", description: "Highest price" },
  { name: "low", description: "Lowest price" },
  { name: "close", description: "Closing price" },
  { name: "totalValueLockedUSD", description: "Total value locked in USD" }
];

// Load JSON files
function loadFieldMappings(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    debugOutput.push({ type: "info", message: `Loaded data from ${filePath}` });
    return data.fields || [];
  } catch (error) {
    debugOutput.push({ type: "error", message: `Failed to load data from ${filePath}: ${error.message}` });
    return [];
  }
}

// Cross-reference logic
function crossReferenceFields(apiName, fieldMappings) {
  const matched = [];
  const missing = [];
  requiredFields.forEach((requiredField) => {
    if (fieldMappings.includes(requiredField)) {
      matched.push(requiredField);
    } else {
      missing.push(requiredField);
    }
  });
  debugOutput.push({
    type: "debug",
    message: `Cross-referenced fields for ${apiName}`,
    matchedFields: matched,
    missingFields: missing,
  });
  return { matched, missing };
}

// Main function
function runCrossReference() {
  const dataFiles = fs.readdirSync(outputsDir).filter((file) => file.endsWith("-fields.json"));
  const consolidatedFilePath = path.join(outputsDir, "consolidated-results.json");
  const crossReferenceReport = {};

  dataFiles.forEach((file) => {
    const filePath = path.join(outputsDir, file);
    const apiName = path.basename(file, "-fields.json");
    const fieldMappings = loadFieldMappings(filePath);
    const result = crossReferenceFields(apiName, fieldMappings);
    crossReferenceReport[apiName] = result;
  });

  // Include consolidated results if available
  if (fs.existsSync(consolidatedFilePath)) {
    debugOutput.push({ type: "info", message: "Consolidated results file found, integrating..." });
    const consolidatedData = loadFieldMappings(consolidatedFilePath);
    crossReferenceReport["consolidated"] = crossReferenceFields("consolidated", consolidatedData);
  } else {
    debugOutput.push({ type: "warn", message: "No consolidated results file found." });
  }

  const reportPath = path.join(outputsDir, "cross-reference-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(crossReferenceReport, null, 2));
  debugOutput.push({ type: "info", message: `Cross-reference report saved to ${reportPath}` });

  // Save debug output
  fs.writeFileSync(debugFilePath, JSON.stringify(debugOutput, null, 2));
  console.log(`Debug output saved to ${debugFilePath}`);
}

// Export the cross-reference function for integration
module.exports = { runCrossReference };
