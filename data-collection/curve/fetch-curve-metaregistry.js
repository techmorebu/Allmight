const { ethers } = require("ethers");
require("dotenv").config();

// Metaregistry Contract Address and ABI
const METAREGISTRY_ADDRESS = "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC";
const ABI = [
  "function getPools(address token) external view returns (address[])",
  "function getPoolInfo(address pool) external view returns (uint256 liquidity, uint256 apy)",
  "function getCoinSymbols(address pool) external view returns (string[] symbols)"
];

async function fetchCurveMetaregistry(tokenAddress) {
  try {
    console.log(`Fetching Curve pools for token: ${tokenAddress}...`);

    // Initialize Ethereum provider
    const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);

    // Initialize Metaregistry contract
    const contract = new ethers.Contract(METAREGISTRY_ADDRESS, ABI, provider);

    // Fetch pools for the given token
    const pools = await contract.getPools(tokenAddress);

    const poolData = [];
    for (const pool of pools) {
      // Fetch pool details
      const [liquidity, apy] = await contract.getPoolInfo(pool);
      const symbols = await contract.getCoinSymbols(pool);

      poolData.push({
        poolAddress: pool,
        liquidity: ethers.utils.formatUnits(liquidity, 18),
        apy: ethers.utils.formatUnits(apy, 2),
        coins: symbols,
      });
    }

    console.log("Fetched Metaregistry Pool Data:", poolData);
    return poolData;
  } catch (error) {
    console.error("Error fetching Curve Metaregistry data:", error.message);
    return [];
  }
}

module.exports = fetchCurveMetaregistry;

// Example Usage
if (require.main === module) {
  const DAI_TOKEN = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // Example: DAI token
  fetchCurveMetaregistry(DAI_TOKEN).then((data) =>
    console.log("Fetched Curve Metaregistry pools:", data)
  );
}
