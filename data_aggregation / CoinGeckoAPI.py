# CoinGeckoAPI.py
import requests
import time

class CoinGeckoAPI:
    BASE_URL = "https://api.coingecko.com/api/v3"

    def __init__(self):
        self.session = requests.Session()

    def get_price(self, symbol, currency="usd"):
        """Fetch current price for a given symbol."""
        url = f"{self.BASE_URL}/simple/price"
        params = {"ids": symbol, "vs_currencies": currency}
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def get_historical_data(self, symbol, date):
        """Fetch historical data for a given symbol on a specific date."""
        url = f"{self.BASE_URL}/coins/{symbol}/history"
        params = {"date": date}
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def rate_limit(self):
        """Respect CoinGecko's rate limit with a delay."""
        time.sleep(1)  # Add delay if necessary