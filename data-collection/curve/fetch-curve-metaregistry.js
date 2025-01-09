const { ethers } = require("ethers");
require("dotenv").config();

const METAREGISTRY_ADDRESS = "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC"; // Curve Metaregistry Address
const ABI = [
  "function getPools(address token) external view returns (address[])",
  "function getPoolInfo(address pool) external view returns (uint256 liquidity, uint256 apy)",
];

async function fetchCurveMetaregistry(tokenAddress) {
  try {
    console.log(`Fetching real-time Curve pools for token: ${tokenAddress}`);
    const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);

    const contract = new ethers.Contract(METAREGISTRY_ADDRESS, ABI, provider);

    const pools = await contract.getPools(tokenAddress);

    const poolData = [];
    for (const pool of pools) {
      const data = await contract.getPoolInfo(pool);
      poolData.push({
        poolAddress: pool,
        liquidity: ethers.utils.formatUnits(data.liquidity, 18),
        apy: ethers.utils.formatUnits(data.apy, 2),
      });
    }

    console.log("Metaregistry Pool Data:", poolData);
    return poolData;
  } catch (error) {
    console.error("Error fetching Curve Metaregistry data:", error.message);
    return [];
  }
}

module.exports = fetchCurveMetaregistry;

// Example Usage
if (require.main === module) {
  const DAI_TOKEN = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  fetchCurveMetaregistry(DAI_TOKEN).then((data) =>
    console.log("Fetched Curve Metaregistry pools:", data)
  );
}
