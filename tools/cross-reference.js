const fs = require("fs");
const path = require("path");

// Define required fields
const requiredFields = [
  "token0Price", "token1Price", "volumeUSD", "volumeToken0", "volumeToken1",
  "liquidity", "liquidityGross", "liquidityNet", "txCount", "feesUSD",
  "open", "high", "low", "close", "tick", "price0", "price1",
  "tickLower", "tickUpper", "untrackedVolumeUSD", "gasPrice", "gasLimit"
];

// Function to cross-reference fields
function crossReferenceFields(mappingDirectory) {
  const files = fs.readdirSync(mappingDirectory);
  const report = [];

  files.forEach(file => {
    if (file.endsWith("_graphql-fields.txt") || file.endsWith("_rest-fields.txt")) {
      const filePath = path.join(mappingDirectory, file);
      const content = fs.readFileSync(filePath, "utf-8");

      const matches = requiredFields.filter(field => content.includes(field));
      const missing = requiredFields.filter(field => !content.includes(field));

      report.push({
        file,
        matches,
        missing,
      });
    }
  });

  return report;
}

// Generate a report
function generateReport(mappingDirectory, outputFile) {
  const results = crossReferenceFields(mappingDirectory);
  let report = "Field Matching Report:\n\n";

  results.forEach(({ file, matches, missing }) => {
    report += `File: ${file}\n`;
    report += `  Matching Fields: ${matches.length > 0 ? matches.join(", ") : "None"}\n`;
    report += `  Missing Fields: ${missing.length > 0 ? missing.join(", ") : "None"}\n\n`;
  });

  fs.writeFileSync(outputFile, report);
  console.log(`✅ Field matching report generated: ${outputFile}`);
}

// Run the cross-referencing process
generateReport("./outputs", "./outputs/field-matching-report.txt");
