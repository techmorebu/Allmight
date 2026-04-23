// scripts/phase0_smoke_test.js
// End-to-end sanity check for Phase 0:
// 1) Run field mapper
// 2) Run cross-reference
// 3) Run master-fetcher once
// 4) Print a summary of results

require("dotenv").config();
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, message, meta = {}) {
  if (!(level in LEVEL_RANK)) level = "info";
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const ts = new Date().toISOString();
  const base = `[PHASE0-TEST][${level.toUpperCase()}][${ts}] ${message}`;
  if (Object.keys(meta).length > 0) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

// Small helper to run a node script as a child process
function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const fullArgs = [scriptPath, ...args];
    log("info", "Starting child script", { scriptPath, args: fullArgs });

    const child = spawn("node", fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (LOG_LEVEL === "debug") {
        process.stdout.write(`[CHILD: ${scriptPath}] ${text}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(`[CHILD-ERR: ${scriptPath}] ${text}`);
    });

    child.on("close", (code) => {
      const result = {
        scriptPath,
        exitCode: code,
        ok: code === 0,
        stdout,
        stderr,
      };

      if (code === 0) {
        log("info", "Child script completed successfully", { scriptPath, exitCode: code });
      } else {
        log("error", "Child script failed", { scriptPath, exitCode: code });
      }

      resolve(result);
    });

    child.on("error", (err) => {
      log("error", "Failed to spawn child script", {
        scriptPath,
        error: err.message,
      });
      resolve({
        scriptPath,
        exitCode: -1,
        ok: false,
        stdout,
        stderr: err.message,
      });
    });
  });
}

function loadFieldMatchingReport() {
  const reportPath = path.resolve(__dirname, "../outputs/field-matching-report.json");
  if (!fs.existsSync(reportPath)) {
    log("warn", "field-matching-report.json not found", { reportPath });
    return null;
  }

  try {
    const raw = fs.readFileSync(reportPath, "utf8");
    const data = JSON.parse(raw);
    return data;
  } catch (err) {
    log("error", "Failed to read field-matching report", {
      error: err.message,
    });
    return null;
  }
}

function summarizeFieldReport(report) {
  const summaries = [];
  for (const [apiName, entry] of Object.entries(report)) {
    summaries.push({
      apiName,
      totalMatched: entry.totalMatched,
      totalMissing: entry.totalMissing,
    });
  }
  return summaries;
}

async function main() {
  log("info", "=== PHASE 0 SMOKE TEST START ===");

  // 1) Run field mapper (one shot)
  const mapperResult = await runNodeScript("scripts/universal-field-mapper.js");
  if (!mapperResult.ok) {
    log("error", "Field mapper failed; later steps may be invalid");
  }

  // 2) Run field cross-reference
  const xrefResult = await runNodeScript("scripts/cross-reference-fields.js");
  if (!xrefResult.ok) {
    log("error", "Cross-reference failed; cannot summarize field coverage properly");
  }

  // 3) Run master fetcher once (no cron)
  const fetcherResult = await runNodeScript("scripts/master-fetcher.js", ["once"]);
  if (!fetcherResult.ok) {
    log("error", "Master fetcher failed; Redis or fetchers may need debugging");
  }

  // 4) Summarize field coverage
  const report = loadFieldMatchingReport();
  if (report) {
    const summaries = summarizeFieldReport(report);
    log("info", "Field coverage summary", { summaries });
  } else {
    log("warn", "No field coverage summary available (missing or invalid report)");
  }

  log("info", "=== PHASE 0 SMOKE TEST COMPLETE ===", {
    mapperOk: mapperResult.ok,
    xrefOk: xrefResult.ok,
    fetcherOk: fetcherResult.ok,
  });
}

if (require.main === module) {
  main().catch((err) => {
    log("error", "Unhandled error in phase0_smoke_test", {
      error: err.message,
      stack: err.stack,
    });
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
