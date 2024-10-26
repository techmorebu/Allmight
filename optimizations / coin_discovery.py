# coin_discovery.py
import requests
import json
import time

class CoinDiscovery:
    MIN_LIQUIDITY = 10000  # Minimum liquidity threshold in USD
    MIN_VOLUME = 5000      # Minimum trading volume threshold in USD
    CONFIG_FILE = 'config/trading_pool.json'
    COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price"

    def __init__(self, tokens):
        self.tokens = tokens

    def get_token_data(self, token_id):
        """Fetches current liquidity and volume data from CoinGecko."""
        params = {'ids': token_id, 'vs_currencies': 'usd'}
        response = requests.get(self.COINGECKO_API, params=params)
        response.raise_for_status()
        return response.json().get(token_id, {})

    def update_trading_pool(self):
        """Updates the trading pool dynamically by adding new tokens meeting criteria."""
        with open(self.CONFIG_FILE, 'r+') as f:
            trading_pool = json.load(f)
            for token_id in self.tokens:
                data = self.get_token_data(token_id)
                if data.get('usd') and data['usd'] >= self.MIN_LIQUIDITY:
                    trading_pool[token_id] = data
            f.seek(0)
            json.dump(trading_pool, f, indent=4)
            f.truncate()

    def monitor_tokens(self):
        """Continuously monitors and adds new tokens to the pool."""
        while True:
            self.update_trading_pool()
            time.sleep(3600)  # Run every hour

if __name__ == "__main__":
    tokens_to_monitor = ["ethereum", "bitcoin", "solana", "cardano"]
    discovery = CoinDiscovery(tokens_to_monitor)
    discovery.monitor_tokens()
