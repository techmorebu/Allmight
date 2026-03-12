let blockNumber = null;
let blockMeta = null;

try {

  const blockResp = await rpc.getBlockNumber(
    'base.fetcher.block',
    { timeoutMs: 1200, hedge: true }
  );

  blockNumber = blockResp.blockNumber;
  blockMeta = blockResp.meta;

} catch (e) {

  return {
    status: 'error',
    data: {
      prices: [],
      blockNumber: null,
      endpoint: null,
      endpointIdsSeen: [],
      endpointsSeen: [],
      stats: {
        successCount: 0,
        failureCount: 2
      },
      failures: [{
        venue: 'block_fetch',
        error: String(e.message || e).slice(0, 160)
      }]
    }
  };

}
