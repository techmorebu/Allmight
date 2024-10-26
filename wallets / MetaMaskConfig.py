# MetaMaskConfig.py
from web3 import Web3
import os
from dotenv import load_dotenv

load_dotenv()  # Load environment variables

class MetaMaskConfig:
    def __init__(self, rpc_url=None):
        self.rpc_url = rpc_url or os.getenv("METAMASK_RPC_URL")
        self.web3 = Web3(Web3.HTTPProvider(self.rpc_url))
        self.private_key = os.getenv("METAMASK_PRIVATE_KEY")
        self.account = self.web3.eth.account.privateKeyToAccount(self.private_key)

    def get_balance(self):
        """Get the balance of the MetaMask account."""
        balance = self.web3.eth.get_balance(self.account.address)
        return self.web3.fromWei(balance, 'ether')

    def send_ether(self, to, value):
        """Send Ether from the MetaMask account to another address."""
        nonce = self.web3.eth.get_transaction_count(self.account.address)
        tx = {
            'nonce': nonce,
            'to': to,
            'value': self.web3.toWei(value, 'ether'),
            'gas': 21000,
            'gasPrice': self.web3.eth.gas_price
        }
        signed_tx = self.account.sign_transaction(tx)
        tx_hash = self.web3.eth.send_raw_transaction(signed_tx.rawTransaction)
        return tx_hash.hex()
