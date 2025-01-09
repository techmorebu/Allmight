const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const redisClient = require("../utils/redis-client");

const redisSetAsync = promisify(redisClient.set).bind(redisClient);

require("dotenv").config();

// Fetcher folder location
const FETCHERS_DIR = path.resolve(__dirname, "../data-collection");

// Dynamically require fetchers
function loadFetchers() {
  const fetchers = {};

  // Scan the directory for fetcher scripts
  fs.readdirSync(FETCHERS_DIR).forEach((file) => {
    if (file.endsWith(".js")) {
      const name = file.replace(".js", "");
      fetchers[name] = require(path.join(FETCHERS_DIR, file));
    }
  });

  return fetchers;
}

// Run all fetchers in parallel
async function runAllFetchers() {
  const fetchers = loadFetchers();

  console.log("Loaded fetchers:", Object.keys(fetchers));

  const results = {};

  // Run all fetchers in parallel
  const fetcherPromises = Object.entries(fetchers).map(async ([name, fetcher]) => {
    console.log(`Running fetcher: ${name}...`);
    try {
      const result = await fetcher();
      results[name] = result;

      // Save each fetcher result to Redis
      await redisSetAsync(name, JSON.stringify(result));
      console.log(`Fetcher ${name} completed and stored in Redis.`);
    } catch (error) {
      console.error(`Error running fetcher ${name}:`, error.message);
    }
  });

  await Promise.all(fetcherPromises);

  console.log("All fetchers completed.");

  // Store aggregated results in Redis
  await redisSetAsync("aggregatedData", JSON.stringify(results));
  console.log("Aggregated data saved to Redis.");
}

// Main runner
if (require.main === module) {
  runAllFetchers()
    .then(() => console.log("Master fetcher execution completed."))
    .catch((error) => console.error("Error in master fetcher:", error.message));
}
