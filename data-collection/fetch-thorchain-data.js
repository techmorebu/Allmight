const axios = require('axios');
const redisClient = require('../utils/redis-client');
require('dotenv').config();

const MIDGARD_API_URL = process.env.THORCHAIN_MIDGARD_API || 'https://midgard.thorchain.info/v2';

/**
 * Fetch Thorchain liquidity pool data
 */
async function fetchThorchainPools() {
    try {
        const response = await axios.get(`${MIDGARD_API_URL}/pools`);
        const pools = response.data;

        // Cache pool data in Redis
        await redisClient.set('Thorchain:Pools', JSON.stringify(pools), 'EX', 60);
        console.log('✅ Thorchain pool data cached successfully.');
    } catch (error) {
        console.error('❌ Error fetching Thorchain pool data:', error.message);
    }
}

/**
 * Fetch Thorchain swap transactions
 */
async function fetchThorchainSwaps() {
    try {
        const response = await axios.get(`${MIDGARD_API_URL}/swaps`);
        const swaps = response.data;

        // Cache swap data in Redis
        await redisClient.set('Thorchain:Swaps', JSON.stringify(swaps), 'EX', 60);
        console.log('✅ Thorchain swap data cached successfully.');
    } catch (error) {
        console.error('❌ Error fetching Thorchain swap data:', error.message);
    }
}

/**
 * Fetch Thorchain network fees
 */
async function fetchThorchainFees() {
    try {
        const response = await axios.get(`${MIDGARD_API_URL}/network`);
        const fees = response.data;

        // Cache network fees in Redis
        await redisClient.set('Thorchain:Fees', JSON.stringify(fees), 'EX', 60);
        console.log('✅ Thorchain network fee data cached successfully.');
    } catch (error) {
        console.error('❌ Error fetching Thorchain fee data:', error.message);
    }
}

module.exports = {
    fetchThorchainPools,
    fetchThorchainSwaps,
    fetchThorchainFees,
};
