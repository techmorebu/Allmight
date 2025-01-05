const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const schema = require("../schemas/dexDataSchema.json");

const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);

const validate = ajv.compile(schema);

/**
 * Validates data against the DEX schema.
 * @param {Object} data - The data to validate.
 * @returns {Object} - Validation result with validity and errors.
 */
function validateApiData(data) {
  const valid = validate(data);
  if (!valid) {
    return { valid: false, errors: validate.errors };
  }
  return { valid: true };
}

module.exports = { validateApiData };
