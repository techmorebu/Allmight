# schedule_tasks.py
import schedule
import time
from coin_discovery import CoinDiscovery
from coin_analyzer import CoinAnalyzer

def run_coin_discovery():
    tokens_to_monitor = ["ethereum", "bitcoin", "solana", "cardano"]
    discovery = CoinDiscovery(tokens_to_monitor)
    discovery.update_trading_pool()
    print("Coin discovery run completed.")

def run_model_retraining():
    # Placeholder for retraining the AI model
    print("AI model retraining started...")

# Schedule tasks
schedule.every().hour.do(run_coin_discovery)
schedule.every().day.at("02:00").do(run_model_retraining)  # Runs daily at 2 AM

if __name__ == "__main__":
    print("Task scheduler started.")
    while True:
        schedule.run_pending()
        time.sleep(60)  # Check every minute