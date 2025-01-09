const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const redisClient = require("../utils/redis-client");

const redisSetAsync = promisify(redisClient.set).bind(redisClient);

require("dotenv").config();

const MASTER_FETCHERS_DIR = path.resolve(__dirname, "../data-collection/masterFetcher");

function loadFetchers() {
  const fetchers = {};
  fs.readdirSync(MASTER_FETCHERS_DIR).forEach((file) => {
    if (file.endsWith(".js")) {
      const name = file.replace(".js", "");
      fetchers[name] = require(path.join(MASTER_FETCHERS_DIR, file));
    }
  });
  return fetchers;
}

async function runFetcher(name, fetcherFunc) {
  try {
    console.log(`Running fetcher: ${name}`);
    const result = await fetcherFunc();
    await redisSetAsync(name, JSON.stringify(result));
    console.log(`Fetcher ${name} completed and stored in Redis.`);
  } catch (error) {
    console.error(`Error in fetcher ${name}:`, error.message);
  }
}

async function runAllFetchers() {
  const fetchers = loadFetchers();
  console.log("Loaded fetchers:", Object.keys(fetchers));

  await Promise.all(
    Object.entries(fetchers).map(([name, func]) => runFetcher(name, func))
  );

  console.log("All fetchers completed.");
}

if (require.main === module) {
  runAllFetchers()
    .then(() => console.log("Master fetcher execution completed."))
    .catch((error) => console.error("Error in master fetcher:", error.message));
}
