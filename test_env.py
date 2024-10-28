test_env.py:

import os
from dotenv import load_dotenv

# Load the environment variables from .env
load_dotenv()

def main():
    # Print a few environment variables to verify
    print("Mode:", os.getenv("MODE"))
    print("CoinGecko API Key:", os.getenv("COINGECKO_API_KEY"))
    print("Redis URL:", os.getenv("REDIS_URL"))
    print("Ethereum RPC URL:", os.getenv("ETHEREUM_RPC_URL"))

if __name__ == "__main__":
    main()