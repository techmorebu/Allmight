const { analyzePrices } = require('../analyzers/price-analyzer');

(async () => {
    console.log('Running Price Analyzer...');
    const profitThreshold = 0.01; // 1% minimum price difference
    await analyzePrices(profitThreshold);
})();
