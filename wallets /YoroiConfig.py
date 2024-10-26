# YoroiConfig.py
import requests
import os
from dotenv import load_dotenv

load_dotenv()

class YoroiConfig:
    BASE_URL = "https://cardano-mainnet.blockfrost.io/api/v0"

    def __init__(self):
        self.api_key = os.getenv("YOROI_API_KEY")
        self.session = requests.Session()
        self.session.headers.update({"project_id": self.api_key})
        self.address = os.getenv("YOROI_ADDRESS")

    def get_balance(self):
        """Get the ADA balance of the Yoroi wallet."""
        url = f"{self.BASE_URL}/addresses/{self.address}"
        response = self.session.get(url)
        response.raise_for_status()
        balance_data = response.json()
        return balance_data['amount'][0]['quantity']

    def send_ada(self, to, amount):
        """Send ADA (simplified; normally requires transaction-building libraries)."""
        raise NotImplementedError("Cardano transactions require advanced handling.")