# CoinGeckoAPI.py
import requests
import redis
import json
import time
import os
from dotenv import load_dotenv

load_dotenv()

# Redis setup for caching
redis_client = redis.StrictRedis(
    host=os.getenv("REDIS_HOST"),
    port=os.getenv("REDIS_PORT"),
    db=0,
    decode_responses=True
)

class CoinGeckoAPI:
    def __init__(self):
        self.cache_expiry = 3600  # Cache expiration in seconds
        self.base_url = "https://api.coingecko.com/api/v3"

    def get_cached_data(self, cache_key):
        """
        Retrieves data from Redis cache if available.
        """
        cached_data = redis_client.get(cache_key)
        if cached_data:
            print(f"Cache hit for {cache_key}")
            return json.loads(cached_data)
        return None

    def set_cache_data(self, cache_key, data):
        """
        Sets data in Redis cache with an expiration.
        """
        redis_client.setex(cache_key, self.cache_expiry, json.dumps(data))

    def get_current_price(self, symbol):
        """
        Fetches current price for a specific token symbol and caches the result.
        """
        cache_key = f"current_price:{symbol}"
        data = self.get_cached_data(cache_key)
        
        if data is None:
            print(f"Fetching new price data for {symbol}")
            response = requests.get(f"{self.base_url}/simple/price?ids={symbol}&vs_currencies=usd")
            data = response.json()
            self.set_cache_data(cache_key, data)
            time.sleep(1)  # Rate limiting
        return data

    def get_historical_data(self, symbol, days=365):
        """
        Fetches historical data for a specific token symbol and caches it.
        """
        cache_key = f"historical_data:{symbol}:{days}"
        data = self.get_cached_data(cache_key)

        if data is None:
            print(f"Fetching new historical data for {symbol}")
            response = requests.get(f"{self.base_url}/coins/{symbol}/market_chart", params={"vs_currency": "usd", "days": days})
            data = response.json()
            self.set_cache_data(cache_key, data)
            time.sleep(1)  # Rate limiting
        return data
