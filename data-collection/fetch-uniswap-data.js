const WebSocket = require('ws');
const redis = require('ioredis');

// Initialize Redis
const redisClient = new redis();

// Uniswap WebSocket endpoint (replace with the actual endpoint for Uniswap)
const UNISWAP_WS_URL = 'wss://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

// Reconnection settings
const MAX_RETRIES = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

let retryCount = 0;

function connectUniswapWebSocket() {
    const ws = new WebSocket(UNISWAP_WS_URL);

    ws.on('open', () => {
        console.log('Connected to Uniswap WebSocket');
        retryCount = 0; // Reset retries on successful connection

        // Subscribe to swaps or liquidity updates
        const subscriptionMessage = {
            id: 1,
            type: 'start',
            payload: {
                query: `
                    subscription {
                        swaps(first: 5, orderBy: timestamp, orderDirection: desc) {
                            pair {
                                token0 {
                                    symbol
                                }
                                token1 {
                                    symbol
                                }
                            }
                            amountUSD
                            timestamp
                        }
                    }
                `,
            },
        };

        ws.send(JSON.stringify(subscriptionMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            if (message.id === 1 && message.type === 'data') {
                const swaps = message.payload.data.swaps;
                swaps.forEach((swap) => {
                    const normalizedData = {
                        pair: `${swap.pair.token0.symbol}-${swap.pair.token1.symbol}`,
                        price: parseFloat(swap.amountUSD),
                        timestamp: new Date(parseInt(swap.timestamp) * 1000).toISOString(),
                    };

                    // Store in Redis
                    const redisKey = `uniswap:${normalizedData.pair}`;
                    redisClient.set(redisKey, JSON.stringify(normalizedData));
                    console.log('Stored data:', normalizedData);
                });
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed. Attempting to reconnect...');
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            setTimeout(connectUniswapWebSocket, RECONNECT_DELAY);
        } else {
            console.error('Max reconnection attempts reached. Please check the WebSocket endpoint.');
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
}

// Start WebSocket connection
connectUniswapWebSocket();
