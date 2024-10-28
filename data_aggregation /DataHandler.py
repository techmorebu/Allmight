import os
import requests
import json
from redis import Redis
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class DataHandler:
    def __init__(self):
        # Connect to Redis using the URL from .env
        self.redis = Redis.from_url(os.getenv("REDIS_URL"))
        # Load API keys from environment variables
        self.coingecko_api_key = os.getenv("COINGECKO_API_KEY")
        self.cryptocompare_api_key = os.getenv("CRYPTOCOMPARE_API_KEY")

    def get_price_data(self, token):
        """Fetches the current price of a given token from CoinGecko and caches it."""
        cache_key = f"price_{token}"
        cached_data = self.redis.get(cache_key)

        # Check if price data is cached in Redis
        if cached_data:
            return json.loads(cached_data)

        # Fetch price data from CoinGecko API
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={token}&vs_currencies=usd"
        response = requests.get(url)
        price_data = response.json()

        # Cache and return price data if available
        if token in price_data:
            self.redis.set(cache_key, json.dumps(price_data), ex=60)  # Cache for 1 minute
            return price_data
        else:
            raise ValueError("Failed to fetch price data")

    def get_volume_data(self, token):
        """Fetches the historical volume data of a given token from CryptoCompare."""
        url = f"https://min-api.cryptocompare.com/data/v2/histoday?fsym={token}&tsym=USD&limit=1&api_key={self.cryptocompare_api_key}"
        response = requests.get(url)
        return response.json()