# LaikaAI.py
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error
from sklearn.externals import joblib
import requests
import redis
import json
import os
from dotenv import load_dotenv

load_dotenv()

# Redis setup for caching
redis_client = redis.StrictRedis(
    host=os.getenv("REDIS_HOST"),
    port=os.getenv("REDIS_PORT"),
    db=0,
    decode_responses=True
)

class LaikaAI:
    def __init__(self):
        self.model = RandomForestRegressor(n_estimators=100, random_state=42)
        self.data_cache = {}
        self.cache_expiry = 3600  # Cache expiration in seconds

    def fetch_data(self, symbol):
        """
        Fetches token data from CoinGecko or another API and caches it in Redis.
        """
        cache_key = f"token_data:{symbol}"
        cached_data = redis_client.get(cache_key)

        if cached_data:
            print(f"Cache hit for {symbol}")
            return json.loads(cached_data)

        print(f"Fetching new data for {symbol}")
        response = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies=usd"
        )
        data = response.json()
        redis_client.setex(cache_key, self.cache_expiry, json.dumps(data))
        return data

    def prepare_data(self, historical_data):
        """
        Prepares and structures the data for training the model.
        """
        df = pd.DataFrame(historical_data)
        df['price_diff'] = df['price'].diff()
        df = df.dropna()
        X = df[['price', 'volume', 'liquidity']].values
        y = df['price_diff'].values
        return X, y

    def train_model(self, historical_data):
        """
        Trains the AI model on historical data.
        """
        X, y = self.prepare_data(historical_data)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        self.model.fit(X_train, y_train)
        predictions = self.model.predict(X_test)
        mse = mean_squared_error(y_test, predictions)
        print(f"Model training complete. Mean Squared Error: {mse}")
        joblib.dump(self.model, "laika_model.pkl")

    def load_model(self):
        """
        Loads a pre-trained model from file.
        """
        if os.path.exists("laika_model.pkl"):
            self.model = joblib.load("laika_model.pkl")
            print("Loaded model from file.")
        else:
            print("No pre-trained model found. Training a new model.")
            historical_data = self.fetch_historical_data()
            self.train_model(historical_data)

    def predict_opportunity(self, current_data):
        """
        Predicts potential profit based on current market conditions.
        """
        X = np.array([[current_data['price'], current_data['volume'], current_data['liquidity']]])
        predicted_price_change = self.model.predict(X)[0]
        print(f"Predicted price change: {predicted_price_change}")
        return predicted_price_change

    def fetch_historical_data(self):
        """
        Fetches historical data from a predefined data source (e.g., CryptoCompare).
        """
        response = requests.get(
            "https://min-api.cryptocompare.com/data/v2/histoday?fsym=ETH&tsym=USD&limit=365"
        )
        historical_data = response.json()['Data']['Data']
        formatted_data = [{
            'price': item['close'],
            'volume': item['volumeto'],
            'liquidity': item['volumeto']  # Assuming volume as a proxy for liquidity
        } for item in historical_data]
        return formatted_data

    def update_model(self, new_data):
        """
        Updates the model with new data if significant changes are detected.
        """
        recent_price = new_data['price']
        if abs(recent_price - self.data_cache.get('last_price', recent_price)) / recent_price > 0.01:
            print("Significant change detected, retraining model.")
            historical_data = self.fetch_historical_data()
            self.train_model(historical_data)
            self.data_cache['last_price'] = recent_price
        else:
            print("No significant change detected. Skipping retraining.")