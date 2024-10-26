# XummConfig.py
import requests
import os
from dotenv import load_dotenv

load_dotenv()

class XummConfig:
    BASE_URL = "https://xumm.app/api/v1"
    
    def __init__(self):
        self.api_key = os.getenv("XUMM_API_KEY")
        self.api_secret = os.getenv("XUMM_API_SECRET")
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": self.api_key,
            "x-api-secret": self.api_secret
        })
        self.address = os.getenv("XUMM_ADDRESS")

    def get_balance(self):
        """Fetch XRP balance for the Xumm wallet."""
        url = f"{self.BASE_URL}/platform/account/{self.address}/balance"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()["balance"]

    def send_xrp(self, destination, amount):
        """Send XRP from the Xumm wallet to another address."""
        url = f"{self.BASE_URL}/platform/transaction"
        payload = {
            "TransactionType": "Payment",
            "Destination": destination,
            "Amount": str(amount)
        }
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()