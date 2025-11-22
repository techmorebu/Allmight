// scripts/test_single_mapper.js
// Quick test for a single API endpoint by calling the mapper module directly.
// Assumes universal-field-mapper.js exports { runMapper }.
// If it doesn't yet, this script can be updated later or skipped.

require("dotenv").config();

(async () => {
  try {
    const mapper = require("./universal-field-mapper");

    if (typeof mapper.runMapper !== "function") {
      console.error(
        "[SINGLE-MAPPER-TEST] universal-field-mapper does not export runMapper(). " +
          "This script is optional; you can rely on phase0_smoke_test instead."
      );
      process.exit(1);
    }

    console.log("[SINGLE-MAPPER-TEST] Starting runMapper()");
    await mapper.runMapper();
    console.log("[SINGLE-MAPPER-TEST] runMapper() completed successfully");
  } catch (err) {
    console.error("[SINGLE-MAPPER-TEST] Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
