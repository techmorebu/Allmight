# OpportunityOptimizer.py
from LaikaAI import LaikaAI
import requests

class OpportunityOptimizer:
    def __init__(self):
        self.ai_model = LaikaAI()
        self.ai_model.load_model()  # Load the pre-trained AI model

    def get_current_data(self, symbol):
        """
        Fetches current market data for a given token symbol.
        """
        response = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true"
        )
        data = response.json()
        return {
            'price': data[symbol]['usd'],
            'volume': data[symbol]['usd_24h_vol'],
            'liquidity': data[symbol]['usd_market_cap']
        }

    def evaluate_opportunity(self, symbol):
        """
        Evaluates the potential profitability of an arbitrage opportunity.
        """
        current_data = self.get_current_data(symbol)
        predicted_change = self.ai_model.predict_opportunity(current_data)
        
        if predicted_change > 0:
            print(f"Profitable opportunity detected for {symbol}. Predicted change: {predicted_change}")
            return True
        else:
            print(f"No profitable opportunity for {symbol}.")
            return False

    def find_opportunities(self, symbols):
        """
        Checks a list of symbols for potential arbitrage opportunities.
        """
        profitable_symbols = []
        for symbol in symbols:
            if self.evaluate_opportunity(symbol):
                profitable_symbols.append(symbol)
        
        print(f"Profitable symbols: {profitable_symbols}")
        return profitable_symbols