# coin_analyzer.py
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import joblib
import pandas as pd

class CoinAnalyzer:
    def __init__(self, model_path='coin_model.pkl', scaler_path='coin_scaler.pkl'):
        # Load model and scaler if they exist, otherwise initialize them
        self.model = joblib.load(model_path) if joblib.os.path.exists(model_path) else RandomForestClassifier()
        self.scaler = joblib.load(scaler_path) if joblib.os.path.exists(scaler_path) else StandardScaler()
        self.is_trained = False

    def train(self, X, y):
        """Train AI model to flag new profitable coins."""
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y)
        joblib.dump(self.model, 'coin_model.pkl')
        joblib.dump(self.scaler, 'coin_scaler.pkl')
        self.is_trained = True

    def predict_coin(self, data):
        """Predict if a coin is profitable based on volume, liquidity, and volatility."""
        data_scaled = self.scaler.transform([data])
        return self.model.predict(data_scaled)[0]

    def update_trading_pool(self, coin_data, trading_pool):
        """Dynamically add or remove coins based on profitability predictions."""
        for coin, data in coin_data.items():
            if self.predict_coin(data):
                trading_pool[coin] = data  # Add or keep coin if it meets criteria
            elif coin in trading_pool:
                del trading_pool[coin]  # Remove coin if it no longer meets criteria
        return trading_pool