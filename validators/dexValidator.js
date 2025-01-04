const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const dexDataSchema = require("../schemas/dexDataSchema");

const ajv = new Ajv();
addFormats(ajv); // Add support for date-time format

/**
 * Validate DEX data against the expanded schema
 * @param {Object} data - The data to validate
 * @returns {Object} Validation result
 */
function validateDexData(data) {
  const validate = ajv.compile(dexDataSchema);
  const isValid = validate(data);

  if (!isValid) {
    return {
      valid: false,
      errors: validate.errors,
    };
  }

  return { valid: true };
}

module.exports = { validateDexData };
