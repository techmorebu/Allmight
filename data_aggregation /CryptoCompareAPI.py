# CryptoCompareAPI.py
import requests

class CryptoCompareAPI:
    BASE_URL = "https://min-api.cryptocompare.com/data"
    API_KEY = "your_api_key_here"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"authorization": f"Apikey {self.API_KEY}"})

    def get_historical_data(self, symbol, currency="USD", limit=2000):
        """Fetch historical price data for backtesting."""
        url = f"{self.BASE_URL}/v2/histoday"
        params = {"fsym": symbol, "tsym": currency, "limit": limit}
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def get_social_metrics(self, symbol):
        """Fetch social metrics for the given symbol."""
        url = f"{self.BASE_URL}/social/coin/latest"
        params = {"coinId": symbol}
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()
