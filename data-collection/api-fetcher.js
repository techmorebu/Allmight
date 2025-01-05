const fetch = require("node-fetch");

/**
 * Fetch data from an API endpoint.
 * @param {string} url - The API URL.
 * @param {string|null} query - Optional GraphQL query.
 * @returns {Promise<object>} - The API response.
 */
async function fetchApiData(url, query = null) {
  try {
    const options = query
      ? {
          method: "POST",
          body: JSON.stringify({ query }),
          headers: { "Content-Type": "application/json" },
        }
      : { method: "GET" };

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching API data:", error.message);
    throw error;
  }
}

module.exports = { fetchApiData };
