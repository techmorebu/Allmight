const fs = require("fs");
const path = require("path");

function loadFieldMappings(directory) {
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json"));
  const mappings = {};

  files.forEach(file => {
    const apiName = file.split("-fields")[0];
    const filePath = path.join(directory, file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    mappings[apiName] = data.fields || [];
  });

  return mappings;
}

function crossReferenceFields(mappings, requiredFields) {
  const report = [];
  const fieldCoverage = {};

  requiredFields.forEach(field => {
    fieldCoverage[field] = [];
  });

  for (const [apiName, fields] of Object.entries(mappings)) {
    requiredFields.forEach(field => {
      if (fields.includes(field)) {
        fieldCoverage[field].push(apiName);
      }
    });
  }

  for (const field of requiredFields) {
    const apis = fieldCoverage[field];
    if (apis.length > 0) {
      report.push(`Field: ${field}\n  Covered by: ${apis.join(", ")}`);
    } else {
      report.push(`Field: ${field}\n  Missing in all APIs`);
    }
  }

  return report;
}

function saveReport(report, outputPath) {
  const reportContent = report.join("\n\n");
  // Overwrite file by using the 'w' flag
  fs.writeFileSync(outputPath, reportContent, { encoding: "utf-8", flag: "w" });
  console.log(`Field Matching Report saved to: ${outputPath}`);
}

// Main Execution
(() => {
  const inputDirectory = "./outputs";
  const outputReportPath = "./outputs/field-matching-report.txt";
  const requiredFields = [
    "token0Price",
    "token1Price",
    "volumeUSD",
    "liquidity",
    "feesUSD",
    "txCount",
    "cumulativeVolumeUSD",
    "inputTokenBalances",
    "totalValueLockedUSD",
    "price0",
    "price1",
    "tickLower",
    "tickUpper",
  ];

  try {
    console.log("Loading field mappings...");
    const mappings = loadFieldMappings(inputDirectory);

    console.log("Cross-referencing fields...");
    const report = crossReferenceFields(mappings, requiredFields);

    console.log("Saving report...");
    saveReport(report, outputReportPath);

    console.log("Field matching completed successfully!");
  } catch (error) {
    console.error("Error during field matching:", error.message);
  }
})();
