# 0xAPI.py
import requests
import time
import json

class ZeroXAPI:
    def __init__(self):
        self.base_url = "https://api.0x.org/swap/v1"
        self.retry_limit = 5

    def get_liquidity_data(self, sell_token, buy_token, sell_amount):
        """
        Fetches liquidity data from 0x API with retry logic for rate limits.
        """
        url = f"{self.base_url}/price?sellToken={sell_token}&buyToken={buy_token}&sellAmount={sell_amount}"
        retries = 0

        while retries < self.retry_limit:
            try:
                response = requests.get(url)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.HTTPError as e:
                print(f"Rate limit hit. Retrying in {2 ** retries} seconds...")
                time.sleep(2 ** retries)  # Exponential backoff
                retries += 1
            except requests.exceptions.RequestException as e:
                print("Request failed:", e)
                break

        return {"error": "Failed to fetch liquidity data after retries"}