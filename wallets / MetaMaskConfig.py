# MetaMaskConfig.py
import json
from web3 import Web3
import os
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

class MetaMaskConfig:
    def __init__(self, network):
        # Load network configurations from wallet_config.json
        with open("config/wallet_config.json", "r") as f:
            config = json.load(f)
        self.rpc_url = config["networks"][network]["rpc_url"]
        self.chain_id = config["networks"][network]["chain_id"]
        self.gas_price_limit = config["networks"][network]["gas_price_limit"]

        # Initialize Web3 connection
        self.web3 = Web3(Web3.HTTPProvider(self.rpc_url))
        
        # Load MetaMask private key from .env file
        self.private_key = os.getenv("METAMASK_PRIVATE_KEY")
        self.account = self.web3.eth.account.privateKeyToAccount(self.private_key)
        self.network = network

    def dynamic_gas_management(self, high_priority=False):
        """
        Set gas price dynamically based on network and trade priority.
        For high-priority transactions, a higher gas price is applied.
        """
        base_gas_price = self.web3.eth.gas_price
        if self.gas_price_limit == "low" or high_priority:
            return base_gas_price
        return int(base_gas_price * 1.1)  # Slight increase for high-priority trades

    def get_balance(self):
        """Get the balance of the MetaMask account in Ether."""
        balance = self.web3.eth.get_balance(self.account.address)
        return self.web3.fromWei(balance, 'ether')

    def send_transaction(self, to, value, high_priority=False):
        """
        Send a transaction with dynamic gas management based on priority.
        
        Args:
            to (str): Recipient address.
            value (float): Amount in Ether to send.
            high_priority (bool): Indicates if transaction should have high priority.
        
        Returns:
            str: Transaction hash if successful.
        """
        # Calculate gas price based on priority
        gas_price = self.dynamic_gas_management(high_priority=high_priority)
        
        # Fetch the current nonce for the account
        nonce = self.web3.eth.get_transaction_count(self.account.address)

        # Create transaction dictionary
        tx = {
            'nonce': nonce,
            'to': to,
            'value': self.web3.toWei(value, 'ether'),
            'gas': 21000,
            'gasPrice': gas_price,
            'chainId': self.chain_id
        }

        # Sign and send the transaction
        signed_tx = self.account.sign_transaction(tx)
        tx_hash = self.web3.eth.send_raw_transaction(signed_tx.rawTransaction)
        
        # Return the transaction hash
        return tx_hash.hex()
