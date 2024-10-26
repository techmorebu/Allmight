# LedgerManager.py
from ledgerblue.comm import getDongle
from ledgerblue.hexParser import IntelHexParser

class LedgerManager:
    def __init__(self):
        self.dongle = getDongle(True)

    def get_public_address(self, path="44'/60'/0'/0/0"):
        """Fetch the public address associated with a given path on the Ledger."""
        apdu = bytes.fromhex("e040000015058000002c8000003c800000008000000000000000")
        result = self.dongle.exchange(apdu)
        return result.hex()

    def sign_transaction(self, tx_data):
        """Sign a transaction using the Ledger hardware wallet."""
        apdu = bytes.fromhex("e0440002050000000008000000000000000000")
        result = self.dongle.exchange(apdu + tx_data)
        return result.hex()