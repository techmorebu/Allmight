require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");

async function fetchRawData(apiUrl, query = null) {
  const options = query
    ? {
        method: "POST",
        body: JSON.stringify({ query }),
        headers: { "Content-Type": "application/json" },
      }
    : { method: "GET" };

  const response = await fetch(apiUrl, options);
  const data = await response.json();
  fs.writeFileSync("raw-data.json", JSON.stringify(data, null, 2));
  console.log("✅ Raw data saved to raw-data.json");
  return data;
}

function analyzeRawData(data) {
  const fieldAnalysis = {};

  function analyzeObject(obj, parent = "") {
    for (const key in obj) {
      const fieldPath = parent ? `${parent}.${key}` : key;
      const value = obj[key];

      if (!fieldAnalysis[fieldPath]) {
        fieldAnalysis[fieldPath] = { type: typeof value, examples: [] };
      }

      if (!fieldAnalysis[fieldPath].examples.includes(value)) {
        fieldAnalysis[fieldPath].examples.push(value);
      }

      if (value && typeof value === "object" && !Array.isArray(value)) {
        analyzeObject(value, fieldPath);
      }
    }
  }

  analyzeObject(data);
  fs.writeFileSync("field-analysis.json", JSON.stringify(fieldAnalysis, null, 2));
  console.log("✅ Field analysis saved to field-analysis.json");
}

function generateSchema(fieldAnalysis) {
  const schema = {
    type: "object",
    properties: {
      price: { type: "number", description: "Curren
