// data-collection/masterFetcher/testFetcher.js
// Phase 0 dummy fetcher to validate master-fetcher pipeline.
// This simulates “real” data without hitting any external API.

// IMPORTANT:
// This file MUST exist during Phase 0 so the master-fetcher
// has at least one working module to run.

module.exports = async function testFetcher() {
  const ts = new Date().toISOString();

  // Simulated payload — this just proves the full system works.
  const payload = {
    fetcher: "testFetcher",
    timestamp: ts,
    status: "ok",
    message: "Test fetcher executed successfully",
    mockData: {
      price: 123.45,
      volume: 9876,
      blockNumber: Math.floor(Math.random() * 10000000)
    }
  };

  // Simulate small delay
  await new Promise((resolve) => setTimeout(resolve, 150));

  return payload;
};
