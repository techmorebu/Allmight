require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

async function fetchData() {
  try {
    console.log("Fetching data from:", process.env.NEW_DEX_API_URL);

    // Load the schema dynamically
    const schemaPath = path.resolve(__dirname, "../logs/generated-schema.json");
    if (!fs.existsSync(schemaPath)) {
      console.error("Error: Schema file not found at", schemaPath);
      return;
    }

    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    console.log("Loaded Schema:", schema);

    // Extract fields from schema.properties
    const queryFields = Object.keys(schema.properties).join(" ");
    console.log("Query Fields:", queryFields);

    const query = {
      query: `{ pools(first: 10) { ${queryFields} } }`
    };

    const response = await fetch(process.env.NEW_DEX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(query)
    });

    if (!response.ok) {
      console.error("Failed to fetch data:", response.statusText);
      return;
    }

    const data = await response.json();
    console.log("Raw Data Fetched:", JSON.stringify(data, null, 2));

    const validatedData = data.data.pools.filter(item =>
      validate(item, Object.keys(schema.properties))
    );
    console.log("Validated Data:", JSON.stringify(validatedData, null, 2));

    return validatedData;
  } catch (error) {
    console.error("Error in fetchData:", error);
  }
}

function validate(item, requiredFields) {
  for (const field of requiredFields) {
    if (!item[field]) {
      console.warn(`Skipping item due to missing field: ${field}`);
      return false;
    }
  }
  return true;
}

fetchData();
