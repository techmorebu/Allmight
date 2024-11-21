const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 300 }); // Cache expires in 5 minutes

// Cache data with a specified key and expiration time
async function cacheData(key, value, ttl = 300) {
    cache.set(key, value, ttl);
}

// Retrieve cached data by key
async function getCachedData(key) {
    return cache.get(key);
}

module.exports = { cacheData, getCachedData };
