const redisClient = require('./redis-client');

/**
 * Fetch cached data by key pattern
 * @param {string} pattern - Redis key pattern
 */
async function fetchCachedData(pattern) {
    const keys = await redisClient.keys(pattern);
    const data = {};

    for (const key of keys) {
        data[key] = await redisClient.get(key);
    }

    return data;
}

module.exports = { fetchCachedData };
