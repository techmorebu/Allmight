// cross-reference-fields.js
// Scans outputs from universal-field-mapper and reports which required fields
// each API provides or is missing.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, message, meta = {}) {
  if (!(level in LEVEL_RANK)) level = "info";
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const ts = new Date().toISOString();
  const base = `[FIELD-XREF][${level.toUpperCase()}][${ts}] ${message}`;
  if (Object.keys(meta).length > 0) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

const outputDir = path.resolve(__dirname, "../../outputs");
const reportFile = path.join(outputDir, "field-matching-report.json");

// This should be aligned with what the arbitrage engine needs.
const requiredFields = [
  "token0Price",
  "token1Price",
  "volumeUSD",
  "liquidity",
  "feesUSD",
  "reserve0",
  "reserve1",
  "totalSupply",
];

// Reads one JSON mapping file and extracts field names.
function loadApiFields(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    // New format: { metadata, fields: [...] }
    if (data && Array.isArray(data.fields)) {
      return data.fields.map((f) => f.name).filter(Boolean);
    }

    // Legacy format: [ { name, ... }, ... ]
    if (Array.isArray(data)) {
      return data.map((f) => f.name).filter(Boolean);
    }

    log("warn", "Unrecognized JSON structure for mapping file", {
      filePath,
      typeof: typeof data,
    });
    return [];
  } catch (err) {
    log("error", "Failed to load mapping file", {
      filePath,
      error: err.message,
    });
    return [];
  }
}

// Main cross-reference routine.
function runCrossReference() {
  if (!fs.existsSync(outputDir)) {
    log("warn", "Output directory does not exist; nothing to cross-reference", {
      outputDir,
    });
    return {};
  }

  const files = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json") && !d.name.includes("field-matching-report"))
    .map((d) => d.name);

  if (files.length === 0) {
    log("warn", "No JSON field mapping files found to cross-reference", { outputDir });
    return {};
  }

  log("info", "Discovered mapping files", { files });

  const report = {};
  for (const fileName of files) {
    const filePath = path.join(outputDir, fileName);
    const apiName = fileName.replace(/-fields-.+\.json$/, "");

    const fieldNames = loadApiFields(filePath);
    if (fieldNames.length === 0) {
      log("warn", "No field names found in mapping file", {
        apiName,
        fileName,
      });
    }

    const matchedFields = [];
    const missingFields = [];

    for (const required of requiredFields) {
      if (fieldNames.includes(required)) {
        matchedFields.push(required);
      } else {
        missingFields.push(required);
      }
    }

    report[apiName] = {
      apiName,
      mappingFile: fileName,
      matchedFields,
      missingFields,
      totalMatched: matchedFields.length,
      totalMissing: missingFields.length,
      timestamp: new Date().toISOString(),
    };

    log("info", "Cross-reference completed for API", {
      apiName,
      totalMatched: matchedFields.length,
      totalMissing: missingFields.length,
    });
  }

  try {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
    log("info", "Field-matching report written", { reportFile });
  } catch (err) {
    log("error", "Failed to write field-matching report", {
      reportFile,
      error: err.message,
    });
  }

  return report;
}

// CLI entry
if (require.main === module) {
  try {
    runCrossReference();
  } catch (err) {
    log("error", "Unhandled error during cross-reference run", {
      error: err.message,
      stack: err.stack,
    });
    process.exitCode = 1;
  }
}

module.exports = {
  runCrossReference,
};
