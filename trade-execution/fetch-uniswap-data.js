const fs = require('fs');
require('dotenv').config();
const axios = require('axios');

const endpoint = process.env.UNISWAP_SUBGRAPH_URL;
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

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
  try {
    await axios.post(discordWebhookUrl, {
      content: message,
    });
    console.log('Alert sent to Discord:', message);
  } catch (error) {
    console.error('Error sending alert to Discord:', error.message);
  }
}

// Save data to a JSON file
function saveDataToFile(data) {
  const filePath = 'historical-data.json';
  let existingData = [];

  try {
    // Read existing data
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingData = JSON.parse(fileContent);
    }

    // Append new data
    existingData.push(data);

    // Write back to the file
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
    console.log('Data successfully saved to historical-data.json');
  } catch (error) {
    console.error('Error saving data to file:', error.message);
  }
}

// Fetch data and monitor conditions
async function fetchData() {
  try {
    const response = await axios.post(endpoint, { query });
    if (response.data && response.data.data) {
      const { factories, bundles } = response.data.data;

      const ethPrice = Number(bundles[0].ethPriceUSD);
      const totalVolume = Number(factories[0].totalVolumeUSD);

      console.log(`ETH Price: $${ethPrice}`);
      console.log(`Total Volume: $${totalVolume}`);

      // Alert conditions
      if (ethPrice < 1800) {
        await sendDiscordAlert(`🚨 ETH price dropped below $1800! Current price: $${ethPrice}`);
      }

      if (totalVolume > 1000000000) {
        await sendDiscordAlert(`🌟 Total volume exceeded $1B! Current volume: $${totalVolume}`);
      }

      // Save data to file
      saveDataToFile({
        timestamp: new Date().toISOString(),
        ethPrice,
        totalVolume,
      });
    } else {
      console.error('No data found in the response.');
    }
  } catch (error) {
    console.error('Error fetching data:', error.message);
  }
}

// Schedule monitoring every minute
setInterval(fetchData, 60000); // Fetch data every 60 seconds
