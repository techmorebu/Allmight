# update_wallets.py
import json

def update_wallet_config():
    with open("config/wallet_config.json", "r") as config_file:
        wallet_config = json.load(config_file)
    
    for network, settings in wallet_config["networks"].items():
        print(f"Updating wallet for {network}:")
        print(f"  RPC URL: {settings['rpc_url']}")
        print(f"  Chain ID: {settings['chain_id']}")
        print(f"  Gas Price Limit: {settings['gas_price_limit']}")

if __name__ == "__main__":
    update_wallet_config()