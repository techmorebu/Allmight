# OpportunityOptimizer.py
import requests
from LaikaAI import LaikaAI

class OpportunityOptimizer:
    def __init__(self, laika_model=None):
        self.laika_model = laika_model if laika_model else LaikaAI()
        self.market_data_url = "https://api.coingecko.com/api/v3/simple/price"

    def get_real_time_data(self, tokens):
        """Fetch real-time price data for the given tokens."""
        params = {"ids": ",".join(tokens), "vs_currencies": "usd"}
        response = requests.get(self.market_data_url, params=params)
        response.raise_for_status()
        return response.json()

    def analyze_opportunity(self, token_pair):
        """Evaluate the arbitrage opportunity for a token pair."""
        market_data = self.get_real_time_data([token_pair[0], token_pair[1]])
        price_in = market_data[token_pair[0]]['usd']
        price_out = market_data[token_pair[1]]['usd']
        
        # Feature engineering for the predictive model
        data = [price_in, price_out, price_in - price_out]
        predicted_profit = self.laika_model.predict_profit(data)
        
        if predicted_profit > 0:
            print(f"Profitable arbitrage opportunity detected: {predicted_profit} USD")
            return True, predicted_profit
        return False, 0

    def find_best_opportunity(self, token_pairs):
        """Find the best arbitrage opportunity among multiple token pairs."""
        best_pair = None
        max_profit = 0
        
        for pair in token_pairs:
            is_profitable, profit = self.analyze_opportunity(pair)
            if is_profitable and profit > max_profit:
                best_pair = pair
                max_profit = profit
                
        return best_pair, max_profit