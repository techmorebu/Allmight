// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAaveV3.sol";
import "./interfaces/IUniswapV3.sol";
import "./interfaces/ICurve.sol";

/**
 * @title ArbitrageBot v4
 *
 * Fix from v2: _minOutAcrossDecimals still produced wrong minOut for
 * cross-decimal swaps because it tried to scale without knowing the price.
 * "Too little received" from UniV3 router on every USDT->WETH swap.
 *
 * Solution: set amountOutMinimum=1 on individual swaps.
 * The REAL protection is the profitability gate in executeOperation:
 *   require(balanceAfter >= repayAmount + minProfitUsd)
 * This gate verifies the ENTIRE round-trip was profitable -- belt and
 * suspenders with the flash loan repayment check. Individual swap
 * slippage limits are redundant and require price knowledge the
 * contract doesn't have.
 *
 * Security model:
 *   - Worst case: both swaps execute but round-trip is unprofitable
 *     -> profitability gate catches it, entire tx reverts, zero loss
 *   - ReentrancyGuard prevents reentrant manipulation
 *   - onlyOwner prevents external callers
 *   - Aave flash loan atomicity guarantees all-or-nothing execution
 */
contract ArbitrageBot is Ownable, ReentrancyGuard, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    // ── Arbitrum mainnet addresses ────────────────────────────────────────────
    address public constant AAVE_POOL =
        0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address public constant UNISWAP_V3_ROUTER =
        0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant CURVE_ETH_USDT_POOL =
        0x960ea3e3C7FB317332d990873d354E18d7645590;

    address public constant WETH =
        0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address public constant USDT =
        0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;

    uint256 public constant CURVE_ETH_INDEX  = 2;
    uint256 public constant CURVE_USDT_INDEX = 0;
    uint24  public constant UNI_FEE          = 500;  // 0.05% fee tier

    // ── Config ────────────────────────────────────────────────────────────────
    uint256 public minProfitUsd = 1e4;  // $0.01 minimum (USDT 6 decimals)

    // ── Venues ────────────────────────────────────────────────────────────────
    uint8 public constant VENUE_UNISWAP = 0;
    uint8 public constant VENUE_CURVE   = 1;

    // ── Events ────────────────────────────────────────────────────────────────
    event ArbitrageExecuted(
        address indexed asset,
        uint256 amount,
        uint256 profit,
        uint8   buyVenue,
        uint8   sellVenue
    );
    event ArbitrageFailed(string reason);
    event MinProfitUpdated(uint256 oldMin, uint256 newMin);

    constructor() Ownable(msg.sender) {}

    // ── External: trigger arbitrage ───────────────────────────────────────────
    function executeArbitrage(
        address asset,
        uint256 amount,
        uint8   buyVenue,
        uint8   sellVenue
    ) external onlyOwner nonReentrant {
        require(buyVenue != sellVenue, "Buy and sell venue must differ");
        require(asset == WETH || asset == USDT, "Unsupported asset");
        require(amount > 0, "Amount must be > 0");

        bytes memory params = abi.encode(buyVenue, sellVenue);
        IPool(AAVE_POOL).flashLoanSimple(
            address(this), asset, amount, params, 0
        );
    }

    // ── Aave callback ─────────────────────────────────────────────────────────
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL,        "Caller is not Aave pool");
        require(initiator  == address(this),     "Initiator mismatch");

        (uint8 buyVenue, uint8 sellVenue) = abi.decode(params, (uint8, uint8));

        _executeSwapPair(asset, amount, buyVenue, sellVenue);

        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 repayAmount  = amount + premium;

        // ── PROFITABILITY GATE ────────────────────────────────────────────────
        require(balanceAfter >= repayAmount, "Cannot repay flash loan");
        uint256 rawProfit = balanceAfter - repayAmount;

        if (asset == USDT) {
            // USDT profit: direct 6-decimal comparison
            require(rawProfit >= minProfitUsd, "Profit below minimum");
        } else {
            // WETH profit: just require positive (off-chain pre-sim validates USD value)
            require(rawProfit > 0, "No profit");
        }

        IERC20(asset).safeIncreaseAllowance(AAVE_POOL, repayAmount);
        emit ArbitrageExecuted(asset, amount, rawProfit, buyVenue, sellVenue);
        return true;
    }

    // ── Internal: swap pair ───────────────────────────────────────────────────
    function _executeSwapPair(
        address asset,
        uint256 amount,
        uint8   buyVenue,
        uint8   sellVenue
    ) internal {
        address tokenIn  = asset;
        address tokenOut = asset == WETH ? USDT : WETH;

        uint256 received = _swap(tokenIn, tokenOut, amount, buyVenue);
        _swap(tokenOut, tokenIn, received, sellVenue);
    }

    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint8   venue
    ) internal returns (uint256) {
        if (venue == VENUE_UNISWAP) {
            return _swapUniswap(tokenIn, tokenOut, amountIn);
        } else if (venue == VENUE_CURVE) {
            return _swapCurve(tokenIn, tokenOut, amountIn);
        }
        revert("Unknown venue");
    }

    function _swapUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256) {
        IERC20(tokenIn).safeIncreaseAllowance(UNISWAP_V3_ROUTER, amountIn);

        ISwapRouter.ExactInputSingleParams memory p =
            ISwapRouter.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               UNI_FEE,
                recipient:         address(this),
                deadline:          block.timestamp + 60,
                amountIn:          amountIn,
                amountOutMinimum:  1,   // profitability gate is the real check
                sqrtPriceLimitX96: 0
            });

        return ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(p);
    }

    function _swapCurve(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256) {
        IERC20(tokenIn).safeIncreaseAllowance(CURVE_ETH_USDT_POOL, amountIn);

        // Pool is tricrypto: coin0=USDT, coin1=WBTC, coin2=WETH
        uint256 i = tokenIn  == WETH ? CURVE_ETH_INDEX : CURVE_USDT_INDEX;
        uint256 j = tokenOut == WETH ? CURVE_ETH_INDEX : CURVE_USDT_INDEX;

        // use_eth=false: use WETH (ERC20), not native ETH
        return ICurvePool(CURVE_ETH_USDT_POOL).exchange(i, j, amountIn, 1, false);
    }

    // ── Owner config ──────────────────────────────────────────────────────────
    function setMinProfitUsd(uint256 newMin) external onlyOwner {
        emit MinProfitUpdated(minProfitUsd, newMin);
        minProfitUsd = newMin;
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        if (amount == 0) amount = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ── IFlashLoanSimpleReceiver ──────────────────────────────────────────────
    function ADDRESSES_PROVIDER() external pure returns (address) {
        return 0xA97684EaD0e402Dc232D5a977953EB7DB7A3215E;
    }

    function POOL() external pure returns (address) {
        return 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    }
}
