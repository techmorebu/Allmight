const WebSocket = require('ws');
const redis = require('ioredis');

// Initialize Redis
const redisClient = new redis();

// GMX WebSocket endpoint
const GMX_WS_URL = 'wss://api.gmx.io/ws';

// Reconnection settings
const MAX_RETRIES = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

let retryCount = 0;

function connectGMXWebSocket() {
    const ws = new WebSocket(GMX_WS_URL);

    ws.on('open', () => {
        console.log('Connected to GMX WebSocket');
        retryCount = 0; // Reset retries on successful connection
        ws.send(JSON.stringify({
            type: 'subscribe',
            topic: 'prices',
        }));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            if (message.type === 'update' && message.prices) {
                message.prices.forEach((priceData) => {
                    const normalizedData = {
                        token: priceData.symbol,
                        price: priceData.price,
                        volume: priceData.volume || 0, // Default to 0 if volume is missing
                        timestamp: new Date().toISOString(),
                    };

                    // Store in Redis
                    const redisKey = `gmx:${normalizedData.token}`;
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
            setTimeout(connectGMXWebSocket, RECONNECT_DELAY);
        } else {
            console.error('Max reconnection attempts reached. Please check the WebSocket endpoint.');
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
}

// Start WebSocket connection
connectGMXWebSocket();
