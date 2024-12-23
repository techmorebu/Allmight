const WebSocket = require('ws');
const redis = require('ioredis');

// Initialize Redis
const redisClient = new redis();

// GMX WebSocket URL
const GMX_WS_URL = 'wss://api.gmx.io/ws';

function connectGMXWebSocket() {
    const ws = new WebSocket(GMX_WS_URL);

    ws.on('open', () => {
        console.log('Connected to GMX WebSocket');
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
                        volume: priceData.volume || 0,
                        timestamp: new Date().toISOString(),
                    };

                    // Store in Redis
                    const redisKey = `gmx:${normalizedData.token}`;
                    redisClient.set(redisKey, JSON.stringify(normalizedData));
                    console.log('Stored data:', normalizedData);
                });
            }
        } catch (err) {
            console.error('Error processing message:', err.message);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed. Reconnecting...');
        setTimeout(connectGMXWebSocket, 5000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
}

// Start GMX WebSocket connection
connectGMXWebSocket();
