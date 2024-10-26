# AaveUniswapData.py
import requests

class AaveAPI:
    BASE_URL = "https://api.thegraph.com/subgraphs/name/aave/protocol"

    def get_liquidity_data(self, asset):
        """Fetch liquidity and flash loan data for an asset on Aave."""
        query = """
        {
            reserves(where: { asset: "%s" }) {
                liquidityRate
                availableLiquidity
            }
        }
        """ % asset
        response = requests.post(self.BASE_URL, json={"query": query})
        response.raise_for_status()
        return response.json()

class UniswapV3API:
    BASE_URL = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3"

    def get_pool_data(self, tokenA, tokenB):
        """Fetch pool data for a token pair on Uniswap v3."""
        query = """
        {
            pools(where: { token0: "%s", token1: "%s" }) {
                liquidity
                volumeUSD
            }
        }
        """ % (tokenA, tokenB)
        response = requests.post(self.BASE_URL, json={"query": query})
        response.raise_for_status()
        return response.json()
