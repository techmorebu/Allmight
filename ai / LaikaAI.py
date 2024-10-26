# LaikaAI.py
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
import joblib

class LaikaAI:
    def __init__(self):
        self.model = RandomForestRegressor(n_estimators=100)
        self.scaler = StandardScaler()
        self.is_trained = False

    def train(self, X, y):
        """Train the AI model using historical data."""
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y)
        self.is_trained = True

    def predict_profit(self, data):
        """Predict the profitability of an arbitrage opportunity."""
        if not self.is_trained:
            raise ValueError("Model is not trained yet.")
        data_scaled = self.scaler.transform([data])
        return self.model.predict(data_scaled)[0]

    def save_model(self, model_path='laika_model.pkl', scaler_path='laika_scaler.pkl'):
        """Save the model and scaler for later use."""
        joblib.dump(self.model, model_path)
        joblib.dump(self.scaler, scaler_path)

    def load_model(self, model_path='laika_model.pkl', scaler_path='laika_scaler.pkl'):
        """Load a saved model and scaler."""
        self.model = joblib.load(model_path)
        self.scaler = joblib.load(scaler_path)
        self.is_trained = True
