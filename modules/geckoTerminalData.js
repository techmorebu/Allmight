const axios = require('axios');
const Bottleneck = require('bottleneck');

const BASE_URL = 'https://api.geckoterminal.com/api/v2';

// Create a rate limiter to adhere to API limits
const limiter = new Bottleneck({
  minTime: 2000, // 1 request every 2 seconds (30 calls per minute)
});

// Function to fetch pool data
async function fetchPoolData(query) {
  try {
    const response = await axios.get(`${BASE_URL}/search/pools`, {
      params: { query },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching pool data:', error.message);
    throw error;
  }
}

// Function to fetch token data
async function fetchTokenData(address) {
  try {
    const response = await axios.get(`${BASE_URL}/tokens/${address}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching token data:', error.message);
    throw error;
  }
}

// Wrap functions with rate limiter
const fetchPoolDataLimited = limiter.wrap(fetchPoolData);
const fetchTokenDataLimited = limiter.wrap(fetchTokenData);

module.exports = { fetchPoolDataLimited, fetchTokenDataLimited };
