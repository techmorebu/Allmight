# CryptoCompareAPI.py
import requests
import redis
import json
import time
from celery import Celery
import os
from dotenv import load_dotenv

load_dotenv()

# Redis setup
redis_client = redis.StrictRedis(
    host=os.getenv("REDIS_HOST"),
    port=os.getenv("REDIS_PORT"),
    db=0,
    decode_responses=True
)

# Celery configuration
celery_app = Celery('crypto_compare', broker=os.getenv("CELERY_BROKER_URL"))

class CryptoCompareAPI:
    def __init__(self):
        self.cache_expiry = 3600  # Cache expiration in seconds
        self.base_url = "https://min-api.cryptocompare.com/data"

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

    @celery_app.task
    def fetch_historical_data(self, symbol, limit=365):
        """
        Fetches historical data for a specific symbol and caches it.
        """
        cache_key = f"historical_data:{symbol}:{limit}"
        data = self.get_cached_data(cache_key)

        if data is None:
            print(f"Fetching new historical data for {symbol}")
            response = requests.get(f"{self.base_url}/v2/histoday", params={
                "fsym": symbol,
                "tsym": "USD",
                "limit": limit
            })
            data = response.json()
            self.set_cache_data(cache_key, data)
            time.sleep(1)  # Rate limiting
        return data

    @celery_app.task
    def fetch_current_data(self, symbol):
        """
        Fetches current price and volume data for a specific symbol.
        """
        cache_key = f"current_data:{symbol}"
        data = self.get_cached_data(cache_key)

        if data is None:
            print(f"Fetching new current data for {symbol}")
            response = requests.get(f"{self.base_url}/price", params={"fsym": symbol, "tsyms": "USD"})
            data = response.json()
            self.set_cache_data(cache_key, data)
            time.sleep(1)  # Rate limiting
        return data