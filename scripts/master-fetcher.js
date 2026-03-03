// master-fetcher.js
// Central runner for all master fetchers. Loads modules dynamically and
// stores their outputs in Redis with robust logging & error handling.
//
// Execution-speed upgrades (2026-03):
// - Seconds-level cron default (hot loop)
// - Parallel fetcher execution with bounded concurrency
// - Per-fetcher timeout + fault isolation (allSettled)
// - Optional Redis run-lock to prevent overlapping cycles
// - Quiet terminal by default; logs to file; tail with standard commands

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");

let redisClient;
try {
  redisClient = require("../utils/redis-client");
} catch (err) {
  console.error("[MASTER-FETCHER] Failed to load redis-client:", err.message);
  // Phase 0 fallback: mock Redis client so script can still run
  redisClient = {
    async set(_key, _value) {
      // keep mock quiet-ish
    },
  };
}

// ------------------------------
// Logging: quiet console by default
// ------------------------------
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const QUIET = String(process.env.MASTER_FETCHER_QUIET ?? "1").toLowerCase() !== "0";
const LOG_FILE =
  process.env.MASTER_FETCHER_LOG_FILE ||
  path.resolve(process.cwd(), "logs", "master_fetcher.log");

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function _ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch (_) {}
}

function _appendFileLine(line) {
  _ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", { encoding: "utf8" });
  } catch (_) {}
}

function log(level, message, meta = {}) {
  if (!(level in LEVEL_RANK)) level = "info";
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const timestamp = new Date().toISOString();
  const base = `[MASTER-FETCHER][${level.toUpperCase()}][${timestamp}] ${message}`;
  const line = Object.keys(meta).length > 0 ? `${base} ${JSON.stringify(meta)}` : base;

  // Always write to log file.
  _appendFileLine(line);

  // Console policy:
  // - QUIET=1 => only WARN/ERROR to terminal
  // - QUIET=0 => honor LOG_LEVEL to terminal
  const shouldConsole =
    (!QUIET && LEVEL_RANK[level] >= LEVEL_RANK[LOG_LEVEL]) ||
    (QUIET && LEVEL_RANK[level] >= LEVEL_RANK["warn"]);

  if (shouldConsole) console.log(line);
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms, label = "timeout") {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeoutPromise = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(t);
  }
}

function _silenceConsole(fn) {
  // Some fetchers log noisily; we capture that output to the log file instead.
  const orig = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  const capture = (lvl) => (...args) => {
    const msg = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    _appendFileLine(`[FETCHER-CONSOLE][${lvl.toUpperCase()}][${new Date().toISOString()}] ${msg}`);
  };

  console.log = capture("log");
  console.info = capture("info");
  console.debug = capture("debug");
  console.warn = capture("warn");
  console.error = capture("error");

  const restore = () => {
    console.log = orig.log;
    console.info = orig.info;
    console.debug = orig.debug;
    console.warn = orig.warn;
    console.error = orig.error;
  };

  return Promise.resolve()
    .then(fn)
    .finally(restore);
}

// ------------------------------
// Fetcher loading
// ------------------------------
const MASTER_FETCHERS_DIR = path.resolve(__dirname, "./data_collection/masterFetcher");

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
        log("warn", "Fetcher module does not export a function", { name, file });
        continue;
      }
      fetchers[name] = mod;
      log("info", "Loaded fetcher module", { name, file });
    } catch (err) {
      log("error", "Failed to load fetcher module", { file, error: err.message });
    }
  }

  log("info", "Fetchers loaded", { count: Object.keys(fetchers).length });
  return fetchers;
}

// ------------------------------
// Run-lock (prevents overlapping cycles)
// ------------------------------
const LOCK_KEY = process.env.MASTER_FETCHER_LOCK_KEY || "lock:master_fetcher";
const LOCK_TTL_MS = Number(process.env.MASTER_FETCHER_LOCK_TTL_MS || 15000); // 15s
async function tryAcquireLock() {
  // If redis is a mock or doesn't support NX/PX, we just proceed.
  try {
    const val = `${process.pid}:${Date.now()}`;
    const res = await redisClient.set(LOCK_KEY, val, "NX", "PX", LOCK_TTL_MS);
    return res === "OK";
  } catch (_) {
    return true;
  }
}

// ------------------------------
// Parallel execution with bounded concurrency
// ------------------------------
const FETCHER_TIMEOUT_MS = Number(process.env.MASTER_FETCHER_TIMEOUT_MS || 4500);
const CONCURRENCY = Math.max(1, Number(process.env.MASTER_FETCHER_CONCURRENCY || 6));
const REDIS_TTL_SECONDS = Number(process.env.MASTER_FETCHER_REDIS_TTL_SECONDS || 60); // fresher by default

async function runOneFetcher(name, fn) {
  const start = Date.now();
  log("debug", "Running fetcher", { name });

  try {
    const run = async () => {
      const data = await fn();
      return data;
    };

    const data = await (QUIET
      ? _silenceConsole(() => withTimeout(run(), FETCHER_TIMEOUT_MS, name))
      : withTimeout(run(), FETCHER_TIMEOUT_MS, name));

    const durationMs = Date.now() - start;

    const payload = {
      ok: true,
      name,
      durationMs,
      timestamp: new Date().toISOString(),
      data,
    };

    try {
      await redisClient.set(`fetcher:${name}`, JSON.stringify(payload), "EX", REDIS_TTL_SECONDS);
      log("debug", "Fetcher result stored in Redis", { name, durationMs });
    } catch (redisErr) {
      log("error", "Failed to store fetcher result in Redis", { name, error: redisErr.message });
    }

    return payload;
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorPayload = {
      ok: false,
      name,
      durationMs,
      timestamp: new Date().toISOString(),
      error: err.message,
    };

    try {
      await redisClient.set(`fetcher:${name}:error`, JSON.stringify(errorPayload), "EX", REDIS_TTL_SECONDS);
    } catch (_) {}

    log("warn", "Fetcher execution failed", { name, durationMs, error: err.message });
    return errorPayload;
  }
}

async function runFetchersOnce() {
  const locked = await tryAcquireLock();
  if (!locked) {
    log("warn", "Skipped run (lock held)", { lockKey: LOCK_KEY });
    return {};
  }

  const fetchers = loadFetchers();
  const entries = Object.entries(fetchers);

  if (entries.length === 0) {
    log("warn", "No fetcher modules found; nothing to run", { dir: MASTER_FETCHERS_DIR });
    return {};
  }

  // ------------------------------
  // Chain-aware scheduling
  // ------------------------------
  // Fetchers may declare: fn.chain = "ethereum" | "base" | "arbitrum" | ...
  // If absent, they go to the "global" bucket.
  function _normChain(x) {
    return String(x || "global").toLowerCase().trim() || "global";
  }

  function _chainConcurrency(chain) {
    // Allow per-chain overrides via env:
    //   MASTER_FETCHER_CHAIN_CONCURRENCY_ETHEREUM=1
    //   MASTER_FETCHER_CHAIN_CONCURRENCY_BASE=2
    const key = `MASTER_FETCHER_CHAIN_CONCURRENCY_${String(chain).toUpperCase()}`;
    const v = Number(process.env[key] || 0);
    if (v > 0) return v;

    // Conservative defaults (stability-first)
    if (chain === "ethereum" || chain === "eth") return 1;
    if (chain === "global") return CONCURRENCY;
    return Math.max(1, Math.min(3, CONCURRENCY)); // L2 default
  }

  function _chainJitterMs(chain) {
    const key = `MASTER_FETCHER_CHAIN_JITTER_MS_${String(chain).toUpperCase()}`;
    const v = Number(process.env[key] || 0);
    if (v > 0) return v;
    return chain === "ethereum" ? 40 : 20;
  }

  const buckets = new Map();
  for (const [name, fn] of entries) {
    const chain = _normChain(fn && fn.chain);
    if (!buckets.has(chain)) buckets.set(chain, []);
    buckets.get(chain).push([name, fn]);
  }

  const results = {};

  const bucketWorkers = Array.from(buckets.entries()).map(async ([chain, list]) => {
    const conc = _chainConcurrency(chain);
    const jitter = _chainJitterMs(chain);
    let idx = 0;

    log("info", "Starting chain bucket", { chain, fetchers: list.length, concurrency: conc, jitterMs: jitter });

    const workers = Array.from({ length: Math.min(conc, list.length) }, async () => {
      while (true) {
        const cur = idx++;
        if (cur >= list.length) break;

        const [name, fn] = list[cur];
        const out = await runOneFetcher(name, fn);
        results[name] = out;

        // jitter between fetchers to avoid synchronized RPC bursts
        await _sleep(jitter);
      }
    });

    await Promise.allSettled(workers);
  });

  await Promise.allSettled(bucketWorkers);
  return results;
}

function startCron() {
  // node-cron supports 6-field cron with seconds.
  // Default hot loop: every 5 seconds (tune per machine/RPC budget).
  const cronExpr = process.env.MASTER_FETCHER_CRON || "*/5 * * * * *";
  log("info", "Starting master fetcher cron", {
    cronExpr,
    quiet: QUIET,
    logFile: LOG_FILE,
    concurrency: CONCURRENCY,
    timeoutMs: FETCHER_TIMEOUT_MS,
  });

  cron.schedule(cronExpr, () => {
    runFetchersOnce().catch((err) => {
      log("error", "Unhandled error while running fetchers from cron", { error: err.message });
    });
  });
}

// CLI entry point
if (require.main === module) {
  const mode = process.argv[2] || "once";

  if (mode === "cron") {
    startCron();
  } else if (mode === "logpath") {
    process.stdout.write(LOG_FILE + "\n");
    process.exit(0);
  } else {
    runFetchersOnce()
      .then(() => {
        log("info", "One-shot fetchers run completed");
        process.exit(0);
      })
      .catch((err) => {
        log("error", "Unhandled error in one-shot run", { error: err.message });
        process.exitCode = 1;
      });
  }
}

module.exports = { runFetchersOnce, startCron };
