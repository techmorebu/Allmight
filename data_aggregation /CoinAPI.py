# CoinAPI.py
import requests

class CoinAPI:
    BASE_URL = "https://rest.coinapi.io/v1"
    API_KEY = "your_api_key_here"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"X-CoinAPI-Key": self.API_KEY})

    def get_asset_info(self, asset_id):
        """Fetch asset details like market cap and volume."""
        url = f"{self.BASE_URL}/assets/{asset_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def get_exchange_rates(self, base_asset, quote_asset):
        """Fetch exchange rates for given asset pair."""
        url = f"{self.BASE_URL}/exchangerate/{base_asset}/{quote_asset}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

