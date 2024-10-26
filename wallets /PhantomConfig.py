# PhantomConfig.py
from solana.rpc.api import Client
import os
from dotenv import load_dotenv
from solana.keypair import Keypair

load_dotenv()

class PhantomConfig:
    def __init__(self):
        self.rpc_url = os.getenv("SOLANA_RPC_URL")
        self.client = Client(self.rpc_url)
        self.private_key = os.getenv("PHANTOM_PRIVATE_KEY")
        self.keypair = Keypair.from_secret_key(bytes.fromhex(self.private_key))

    def get_balance(self):
        """Get the SOL balance for the Phantom wallet."""
        return self.client.get_balance(self.keypair.public_key)["result"]["value"]

    def send_sol(self, to, amount):
        """Send SOL from the Phantom wallet to another address."""
        from solana.transaction import Transaction
        from solana.system_program import TransferParams, transfer

        txn = Transaction()
        txn.add(
            transfer(
                TransferParams(
                    from_pubkey=self.keypair.public_key,
                    to_pubkey=to,
                    lamports=amount
                )
            )
        )
        return self.client.send_transaction(txn, self.keypair)