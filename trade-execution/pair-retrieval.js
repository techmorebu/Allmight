require('dotenv').config();
const axios = require('axios');

// Get the subgraph endpoint from the environment variables
const endpoint = process.env.UNISWAP_SUBGRAPH_URL;

// Define the GraphQL query
const query = `
{
  factories(first: 5) {
    id
    poolCount
    txCount
    totalVolumeUSD
  }
  bundles(first: 5) {
    id
    ethPriceUSD
  }
}
`;

// Function to fetch data using Axios
async function fetchData() {
  try {
    const response = await axios.post(endpoint, { query });
    if (response.data && response.data.data) {
      console.log('Fetched Data:');
      console.log(JSON.stringify(response.data.data, null, 2));
    } else {
      console.error('No data found in the response.');
    }
  } catch (error) {
    console.error('Error fetching data:', error.message);
  }
}

// Execute the function
fetchData();
