# 0xAPI.py
import requests

class ZeroXAPI:
    BASE_URL = "https://api.0x.org"

    def __init__(self):
        self.session = requests.Session()

    def get_quote(self, sell_token, buy_token, sell_amount):
        """Fetch a trade quote for a token swap."""
        url = f"{self.BASE_URL}/swap/v1/quote"
        params = {"sellToken": sell_token, "buyToken": buy_token, "sellAmount": sell_amount}
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def get_price_impact(self, sell_token, buy_token, sell_amount):
        """Estimate price impact for the trade."""
        quote = self.get_quote(sell_token, buy_token, sell_amount)
        return quote.get('priceImpact', None)
