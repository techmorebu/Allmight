const fs = require('fs');
require('dotenv').config({ path: '/path/to/your/project/.env' }); // Explicitly load .env file
const axios = require('axios');
const { analyzeTrends } = require('./analyze-trends'); // Import trend analysis function

// Debug: Verify environment variables are loaded
const endpoint = process.env.UNISWAP_SUBGRAPH_URL;

if (!endpoint) {
  console.error("UNISWAP_SUBGRAPH_URL is not set in the .env file or is invalid.");
  process.exit(1); // Exit if the URL is not loaded
}

console.log("Using endpoint:", endpoint); // Debug log

// GraphQL query
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

// Send alert to Discord
async function sendDiscordAlert(message) {
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL; // Ensure Discord URL is also loaded
  if (!discordWebhookUrl) {
    console.error("DISCORD_WEBHOOK_URL is not set in the .env file or is invalid.");
    return;
  }

  try {
    await axios.post(discordWebhookUrl, { content: message });
    console.log('Alert sent to Discord:', message);
  } catch (error) {
    console.error('Error sending alert to Discord:', error.message);
  }
}

// Save data to JSON file
function saveDataToFile(data) {
  const filePath = '/path/to/your/project/logs/historical-data.json'; // Ensure full path for cron
  let existingData = [];

  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingData = JSON.parse(fileContent);
    }

    existingData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
    console.log('Data saved to historical-data.json');
  } catch (error) {
    console.error('Error saving data to file:', error.message);
  }
}

// Fetch data and analyze trends
async function fetchData() {
  try {
    const response = await axios.post(endpoint, { query });

    if (response.data && response.data.data) {
      const { factories, bundles } = response.data.data;

      const ethPrice = Number(bundles[0].ethPriceUSD);
      const totalVolume = Number(factories[0].totalVolumeUSD);

      console.log(`ETH Price: $${ethPrice}`);
      console.log(`Total Volume: $${totalVolume}`);

      const data = {
        timestamp: new Date().toISOString(),
        ethPrice,
        totalVolume,
      };

      saveDataToFile(data);

      // Analyze trends and include in the alert
      const trendAnalysis = analyzeTrends(); // Ensure analyzeTrends is working
      const alertMessage = `
🚨 New Data Synced:
- ETH Price: $${ethPrice.toFixed(2)}
- Total Volume: $${totalVolume.toLocaleString()}

📊 Trend Analysis:
${trendAnalysis}
      `;

      await sendDiscordAlert(alertMessage);
    } else {
      console.error('No data found in the response.');
    }
  } catch (error) {
    console.error('Error fetching data:', error.message);
  }
}

// Execute fetch function
fetchData();
