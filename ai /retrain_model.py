# retrain_model.py
import pandas as pd
from LaikaAI import LaikaAI
import json

def load_historical_data(file_path):
    """Load historical market data for training."""
    return pd.read_csv(file_path)

def preprocess_data(df):
    """Process data for training."""
    X = df[['price_in', 'price_out', 'price_diff']].values
    y = df['profit'].values
    return X, y

def retrain_model(laika_model, historical_data_path):
    """Retrain the Laika AI model with historical data."""
    df = load_historical_data(historical_data_path)
    X, y = preprocess_data(df)
    
    # Train the model with updated data
    laika_model.train(X, y)
    laika_model.save_model()

if __name__ == "__main__":
    model = LaikaAI()
    historical_data_path = "data/historical_market_data.csv"
    retrain_model(model, historical_data_path)
    print("Model retrained and saved.")
