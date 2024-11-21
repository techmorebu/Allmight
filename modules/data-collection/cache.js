const redis = require("redis");
const { promisify } = require("util");
const { logger } = require("../monitoring/logger");

const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);

client.on("error", (err) => {
    logger.error(`Redis client error: ${err.message}`);
});

async function cacheData(key, value, ttl = 300) {
    try {
        await setAsync(key, JSON.stringify(value), "EX", ttl);
        logger.info(`Cached data for key: ${key}`);
    } catch (error) {
        logger.error(`Error caching data: ${error.message}`);
        throw error;
    }
}

async function getCachedData(key) {
    try {
        const cachedData = await getAsync(key);
        if (cachedData) {
            logger.info(`Cache hit for key: ${key}`);
            return JSON.parse(cachedData);
        }
        logger.info(`Cache miss for key: ${key}`);
        return null;
    } catch (error) {
        logger.error(`Error fetching cached data: ${error.message}`);
        throw error;
    }
}

module.exports = { cacheData, getCachedData };
