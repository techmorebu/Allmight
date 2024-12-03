const { analyzeTrends } = require('./analyze-trends');

const mockTokenData = {
  ethereum: {
    usd: 3612.93,
    usd_market_cap: 435145092801.0696,
    usd_24h_vol: 44211393381.66678,
    usd_24h_change: 0.3199,
  },
  zksync: {
    usd: 0.2207,
    usd_market_cap: 811185501.2918984,
    usd_24h_vol: 261252014.8039644,
    usd_24h_change: 3.7264,
  },
};

(async () => {
  try {
    const trends = analyzeTrends(mockTokenData);
    console.log('Processed Trends:', JSON.stringify(trends, null, 2));
  } catch (error) {
    console.error('Error analyzing trends:', error.message);
  }
})();
