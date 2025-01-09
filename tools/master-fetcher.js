const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const redisClient = require("../utils/redis-client");
const os = require("os");
const cluster = require("cluster");

const redisSetAsync = promisify(redisClient.set).bind(redisClient);

require("dotenv").config();

// Fetcher directory
const MASTER_FETCHERS_DIR = path.resolve(__dirname, "../data-collection/masterFetcher");

// Maximum retries for failed fetchers
const MAX_RETRIES = 3;

// Load fetchers dynamically
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

// Run a single fetcher with retries
async function runFetcher(fetcherName, fetcherFunc, retries = 0) {
  try {
    console.log(`Running fetcher: ${fetcherName}`);
    const result = await fetcherFunc();

    // Store result in Redis
    await redisSetAsync(fetcherName, JSON.stringify(result));
    console.log(`Fetcher ${fetcherName} completed successfully.`);
    return result;
  } catch (error) {
    console.error(`Error in fetcher ${fetcherName}: ${error.message}`);

    if (retries < MAX_RETRIES) {
      console.log(`Retrying fetcher ${fetcherName} (${retries + 1}/${MAX_RETRIES})...`);
      return runFetcher(fetcherName, fetcherFunc, retries + 1);
    } else {
      console.error(`Fetcher ${fetcherName} failed after ${MAX_RETRIES} retries.`);
      return null;
    }
  }
}

// Run all fetchers in parallel
async function runAllFetchers() {
  const fetchers = loadFetchers();
  console.log("Loaded fetchers:", Object.keys(fetchers));

  const results = {};
  const fetcherPromises = [];

  for (const [name, func] of Object.entries(fetchers)) {
    fetcherPromises.push(
      runFetcher(name, func).then((result) => {
        if (result) results[name] = result;
      })
    );
  }

  await Promise.all(fetcherPromises);

  console.log("All fetchers completed.");

  // Store aggregated results in Redis
  await redisSetAsync("aggregatedData", JSON.stringify(results));
  console.log("Aggregated data saved to Redis.");
}

// Optimize parallel processing with multi-threading
function startMasterFetcher() {
  const cpuCount = os.cpus().length;

  if (cluster.isMaster) {
    console.log(`Master fetcher running on ${cpuCount} CPUs.`);
    for (let i = 0; i < cpuCount; i++) cluster.fork();

    cluster.on("exit", (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} exited.`);
    });
  } else {
    runAllFetchers()
      .then(() => console.log(`Worker ${process.pid} completed its tasks.`))
      .catch((error) => console.error(`Worker ${process.pid} encountered an error: ${error.message}`));
  }
}

// Run the script
if (require.main === module) {
  startMasterFetcher();
}
