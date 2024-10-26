# retrain_model.py
from LaikaAI import LaikaAI

def retrain_model():
    """
    Retrains the AI model with new historical data.
    """
    ai_model = LaikaAI()
    historical_data = ai_model.fetch_historical_data()  # Fetch fresh historical data
    ai_model.train_model(historical_data)  # Retrain the model
    print("Model retraining completed and saved as 'laika_model.pkl'.")

if __name__ == "__main__":
    retrain_model()