// master-fetcher.js
// Central runner for all master fetchers. Loads modules dynamically and
// stores their outputs in Redis with robust logging & error handling.

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");

let redisClient;
try {
  // Adjust path if your redis client lives elsewhere
  redisClient = require("../utils/redis-client");
} catch (err) {
  console.error("[MASTER-FETCHER] Failed to load redis-client:", err.message);
  // Phase 0 fallback: mock Redis client so script can still run
  redisClient = {
    async set(key, value) {
      console.log(`[MASTER-FETCHER][MOCK REDIS] SET ${key} = ${value.slice(0, 120)}...`);
    },
  };
}

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const MASTER_FETCHERS_DIR = path.resolve(__dirname, "./data_collection/masterFetcher");

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, message, meta = {}) {
  if (!(level in LEVEL_RANK)) level = "info";
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const timestamp = new Date().toISOString();
  const base = `[MASTER-FETCHER][${level.toUpperCase()}][${timestamp}] ${message}`;
  if (Object.keys(meta).length > 0) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

function loadFetchers() {
  const fetchers = {};
  let files;

  try {
    files = fs
      .readdirSync(MASTER_FETCHERS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".js"))
      .map((d) => d.name);
  } catch (err) {
    log("error", "Failed to read master fetchers directory", {
      dir: MASTER_FETCHERS_DIR,
      error: err.message,
    });
    return fetchers;
  }

  log("debug", "Discovered fetcher files", { files });

  for (const file of files) {
    const name = file.replace(".js", "");
    const fullPath = path.join(MASTER_FETCHERS_DIR, file);

    try {
      const mod = require(fullPath);
      if (typeof mod !== "function") {
        log("warn", "Fetcher module does not export a function", {
          name,
          file,
        });
        continue;
      }
      fetchers[name] = mod;
      log("info", "Loaded fetcher module", { name, file });
    } catch (err) {
      log("error", "Failed to load fetcher module", {
        file,
        error: err.message,
        stack: err.stack,
      });
    }
  }

  log("info", "Fetchers loaded", { count: Object.keys(fetchers).length });
  return fetchers;
}

async function runFetchersOnce() {
  const fetchers = loadFetchers();
  const names = Object.keys(fetchers);

  if (names.length === 0) {
    log("warn", "No fetcher modules found; nothing to run", {
      dir: MASTER_FETCHERS_DIR,
    });
    return {};
  }

  const results = {};

  for (const name of names) {
    const fn = fetchers[name];
    const start = Date.now();
    log("info", "Running fetcher", { name });

    try {
      const data = await fn();
      const durationMs = Date.now() - start;

      const payload = {
        ok: true,
        name,
        durationMs,
        timestamp: new Date().toISOString(),
        data,
      };

      results[name] = payload;

      try {
        await redisClient.set(`fetcher:${name}`, JSON.stringify(payload));
        log("info", "Fetcher result stored in Redis", {
          name,
          durationMs,
        });
      } catch (redisErr) {
        log("error", "Failed to store fetcher result in Redis", {
          name,
          error: redisErr.message,
        });
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorPayload = {
        ok: false,
        name,
        durationMs,
        timestamp: new Date().toISOString(),
        error: err.message,
        stack: err.stack,
      };

      results[name] = errorPayload;

      try {
        await redisClient.set(`fetcher:${name}:error`, JSON.stringify(errorPayload));
      } catch (redisErr) {
        log("error", "Failed to store fetcher error in Redis", {
          name,
          error: redisErr.message,
        });
      }

      log("error", "Fetcher execution failed", {
        name,
        durationMs,
        error: err.message,
      });
    }
  }

  return results;
}

function startCron() {
  const cronExpr = process.env.MASTER_FETCHER_CRON || "*/2 * * * *"; // every 2 minutes by default
  log("info", "Starting master fetcher cron", { cronExpr });

  cron.schedule(cronExpr, () => {
    runFetchersOnce().catch((err) => {
      log("error", "Unhandled error while running fetchers from cron", {
        error: err.message,
        stack: err.stack,
      });
    });
  });
}

// CLI entry point
if (require.main === module) {
  const mode = process.argv[2] || "once";

  if (mode === "cron") {
    startCron();
  } else {
    runFetchersOnce()
      .then(() => {
        log("info", "One-shot fetchers run completed");
        process.exit(0);
      })
      .catch((err) => {
        log("error", "Unhandled error in one-shot run", {
          error: err.message,
          stack: err.stack,
        });
        process.exitCode = 1;
      });
  }
}

module.exports = {
  runFetchersOnce,
  startCron,
};
