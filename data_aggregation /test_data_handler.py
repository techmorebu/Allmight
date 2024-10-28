from DataHandler import DataHandler

def test_data_handler():
    # Initialize DataHandler instance
    handler = DataHandler()
    token = "bitcoin"  # Use lowercase token names for CoinGecko API

    # Test price data fetching and caching
    price_data = handler.get_price_data(token)
    print("Price Data:", price_data)

    # Test volume data fetching
    volume_data = handler.get_volume_data("BTC")
    print("Volume Data:", volume_data)

if __name__ == "__main__":
    test_data_handler()