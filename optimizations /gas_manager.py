# gas_manager.py
import json

class GasManager:
    GAS_TANK_FILE = 'gas_tank.json'

    def __init__(self):
        self.gas_tank = self.load_gas_tank()

    def load_gas_tank(self):
        """Loads the current gas tank balance from file."""
        try:
            with open(self.GAS_TANK_FILE, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            return {"balance": 0}

    def update_gas_tank(self, cost):
        """Deducts gas cost from the gas tank balance."""
        self.gas_tank["balance"] -= cost
        with open(self.GAS_TANK_FILE, "w") as f:
            json.dump(self.gas_tank, f)

    def check_gas_priority(self, network):
        """Determine if Ethereum should be prioritized based on gas balance."""
        return network == "ethereum" and self.gas_tank["balance"] > 0.1  # Example threshold

    def add_gas_funds(self, amount):
        """Add funds to the gas tank balance."""
        self.gas_tank["balance"] += amount
        with open(self.GAS_TANK_FILE, "w") as f:
            json.dump(self.gas_tank, f)