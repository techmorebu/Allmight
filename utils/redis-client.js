//Legacy
const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Redis Client Singleton
 */
class RedisClient {
    constructor() {
        if (!RedisClient.instance) {
            this.client = new Redis(REDIS_URL);
            this.client.on('connect', () => console.log('Redis connected.'));
            this.client.on('error', (err) => console.error('Redis error:', err));
            RedisClient.instance = this;
        }
        return RedisClient.instance;
    }

    getClient() {
        return this.client;
    }
}

module.exports = new RedisClient().getClient();
