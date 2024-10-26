# TransactionHandler.py
from web3 import Web3
from FlashbotsAPI import FlashbotsAPI
import time

class TransactionHandler:
    def __init__(self, provider_url, flashbots_relay_url="https://relay.flashbots.net"):
        self.web3 = Web3(Web3.HTTPProvider(provider_url))
        self.flashbots = FlashbotsAPI(provider_url, flashbots_relay_url)

    def send_transaction(self, to, value, gas=21000, gas_price=None):
        """Send a regular Ethereum transaction."""
        gas_price = gas_price or self.web3.eth.gas_price
        tx = {
            'to': to,
            'value': value,
            'gas': gas,
            'gasPrice': gas_price,
            'nonce': self.web3.eth.get_transaction_count(self.web3.eth.default_account),
        }
        signed_tx = self.web3.eth.account.sign_transaction(tx, self.web3.eth.default_account)
        tx_hash = self.web3.eth.send_raw_transaction(signed_tx.rawTransaction)
        return tx_hash.hex()

    def send_protected_transaction(self, to, value, gas=21000, use_flashbots=True):
        """Send a transaction with front-running protection via Flashbots if specified."""
        tx = {
            'to': to,
            'value': value,
            'gas': gas,
            'gasPrice': self.flashbots.check_gas_price_optimization(),
            'nonce': self.web3.eth.get_transaction_count(self.web3.eth.default_account),
        }
        signed_tx = self.web3.eth.account.sign_transaction(tx, self.web3.eth.default_account)
        
        if use_flashbots:
            try:
                result = self.flashbots.send_flashbots_transaction(signed_tx.rawTransaction.hex())
                print("Flashbots transaction sent:", result)
                return result
            except Exception as e:
                print(f"Flashbots failed: {e}")
        
        # Fall back to sending as a regular transaction if Flashbots fails
        tx_hash = self.web3.eth.send_raw_transaction(signed_tx.rawTransaction)
        return tx_hash.hex()

    def check_transaction_status(self, tx_hash):
        """Check the status of a transaction by its hash."""
        tx_receipt = self.web3.eth.get_transaction_receipt(tx_hash)
        if tx_receipt:
            return tx_receipt['status'] == 1  # 1 means successful
        return False

    def retry_transaction(self, tx, max_retries=3):
        """Retry a failed transaction up to max_retries times."""
        for attempt in range(max_retries):
            try:
                tx_hash = self.web3.eth.send_raw_transaction(tx.rawTransaction)
                return tx_hash.hex()
            except Exception as e:
                print(f"Transaction failed on attempt {attempt + 1}: {e}")
                time.sleep(5)
        raise RuntimeError("Transaction failed after maximum retries.")