const fs = require("fs");
const path = require("path");
const stringSimilarity = require("string-similarity");

const outputsDir = path.resolve(__dirname, "../outputs");
const reportPath = path.join(outputsDir, "cross-reference-report.json");

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
  "totalValueLockedUSD",
];

const fieldSynonyms = {
  token0Price: ["price0", "priceToken0", "baseTokenPrice", "price_base"],
  volumeUSD: ["usdVolume", "tradingVolumeUSD", "volume_usd", "totalVolumeUSD"],
  feesUSD: ["usdFees", "tradingFeesUSD", "fees_usd", "totalFeesUSD"],
  liquidity: ["poolLiquidity", "totalLiquidity", "liquidityUSD"],
  txCount: ["transactionCount", "tradeCount", "swapCount", "numberOfTransactions"],
  open: ["openingPrice", "startPrice"],
  high: ["highestPrice", "maxPrice"],
  low: ["lowestPrice", "minPrice"],
  close: ["closingPrice", "endPrice"],
  totalValueLockedUSD: ["TVL", "lockedValueUSD", "valueLockedUSD", "tvl_usd"],
};

const fieldWeights = {
  token0Price: 3,
  token1Price: 3,
  volumeUSD: 2,
  feesUSD: 2,
  liquidity: 1,
  txCount: 1,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  totalValueLockedUSD: 2,
};

function runCrossReference() {
  console.log("Running Cross-Referencing...");

  const dataFiles = fs.readdirSync(outputsDir).filter((file) => file.endsWith("-fields.json"));
  const crossReferenceReport = {};

  dataFiles.forEach((file) => {
    const filePath = path.join(outputsDir, file);
    const apiName = path.basename(file, "-fields.json");
    const { fields } = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const matched = [];
    const missing = [];

    requiredFields.forEach((requiredField) => {
      const synonyms = fieldSynonyms[requiredField] || [];
      const allOptions = [requiredField, ...synonyms];
      const bestMatch = stringSimilarity.findBestMatch(requiredField, fields);

      if (bestMatch.bestMatch.rating > 0.8 || fields.some((f) => allOptions.includes(f))) {
        matched.push(requiredField);
      } else {
        missing.push(requiredField);
      }
    });

    const weightedScore = matched.reduce((sum, field) => sum + (fieldWeights[field] || 0), 0);

    crossReferenceReport[apiName] = { matched, missing, weightedScore };
  });

  fs.writeFileSync(reportPath, JSON.stringify(crossReferenceReport, null, 2));
  console.log(`Cross-Referencing Report saved to ${reportPath}`);
}

module.exports = { runCrossReference };
