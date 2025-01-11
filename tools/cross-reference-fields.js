const fs = require("fs");
const path = require("path");

// Directories for outputs and debug logs
const outputsDir = path.join(__dirname, "../outputs");
const debugDir = path.join(outputsDir, "debug");
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

const debugFilePath = path.join(debugDir, "chatcrossdebug.json");
const debugOutput = [];

// Required fields
const requiredFields = [
  "token0Price",
  "token1Price",
  "volumeUSD",
  "feesUSD",
  "liquidity",
  "txCount",
  "open",
  "high",
  "low",
  "close",
  "totalValueLockedUSD"
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
    missingFields: missing
  });
  return { matched, missing };
}

// Main function
function runCrossReference() {
  const dataFiles = fs.readdirSync(outputsDir).filter((file) => file.endsWith("-fields.json"));
  const crossReferenceReport = {};

  dataFiles.forEach((file) => {
    const filePath = path.join(outputsDir, file);
    const apiName = path.basename(file, "-fields.json");
    const fieldMappings = loadFieldMappings(filePath);
    const result = crossReferenceFields(apiName, fieldMappings);
    crossReferenceReport[apiName] = result;
  });

  const reportPath = path.join(outputsDir, "cross-reference-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(crossReferenceReport, null, 2));
  debugOutput.push({ type: "info", message: `Cross-reference report saved to ${reportPath}` });

  // Save debug output
  fs.writeFileSync(debugFilePath, JSON.stringify(debugOutput, null, 2));
  console.log(`Debug output saved to ${debugFilePath}`);
}

// Run the script
runCrossReference();
