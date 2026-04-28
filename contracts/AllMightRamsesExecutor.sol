// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * AllMightRamsesExecutor.sol  —  v2 (direct-pool)
 * Boss ruling 2026-04-28: direct IRamsesV2Pool.swap() + ramsesV2SwapCallback
 * Patch 2026-04-28: sqrtPriceLimitX96 = slot0().sqrtPriceX96 ±2.5% (Boss Option A)
 *   Eliminates MIN/MAX_SQRT_RATIO overflow in zeroForOne=true path
 * No router. Pool: 0x30AFBcF9458c3131A6d051C621E307E6278E4110 (verified on-chain)
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IUniV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

/// @notice Ramses V2 CL pool direct swap interface
/// Confirmed selector: ramsesV2SwapCallback(int256,int256,bytes) = 0x654b6487
interface IRamsesV2Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    /// @notice Returns current pool price, tick, and other state
    /// Used to compute sqrtPriceLimitX96 dynamically (avoids MIN/MAX overflow in tick math)
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24   tick,
        uint16  observationIndex,
        uint16  observationCardinality,
        uint16  observationCardinalityNext,
        uint8   feeProtocol,
        bool    unlocked
    );
}

contract AllMightRamsesExecutor is IFlashLoanSimpleReceiver {

    // ── Direction constants ───────────────────────────────────────────────────
    uint8 public constant DIRECTION_RAMSES_FIRST = 0;
    uint8 public constant DIRECTION_UNI_FIRST    = 1;

    // ── UniV3 fee for WETH/USDC 0.01% pool ───────────────────────────────────
    uint24 public constant UNIV3_FEE = 100;

    // ── Immutables ────────────────────────────────────────────────────────────
    address     public immutable owner;
    IPool       public immutable aavePool;
    IUniV3SwapRouter public immutable uniV3Router;
    IRamsesV2Pool    public immutable ramsesPool;
    address     public immutable WETH;
    address     public immutable USDC;
    address     public immutable token0; // WETH on Arbitrum (sorts lower)
    address     public immutable token1; // USDC on Arbitrum (sorts higher)
    address     public profitRecipient;

    // ── Reentrancy ────────────────────────────────────────────────────────────
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }
    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    // ── Events ────────────────────────────────────────────────────────────────
    event ArbRequested(address indexed borrowAsset, uint256 amount, uint8 direction, uint256 minProfit);
    event ArbExecuted(address indexed borrowAsset, uint256 amount, uint256 premium, uint256 finalBalance, uint256 profit);
    event ProfitRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // ── Packed flash-loan params ──────────────────────────────────────────────
    struct ArbParams {
        uint8   direction;
        uint256 minProfit;
        uint256 amountOutMinA;
        uint256 amountOutMinB;
        uint256 deadline;
    }

    // ── Packed Ramses callback params ─────────────────────────────────────────
    struct RamsesCallbackData {
        address tokenOwed; // token the pool expects back
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _aavePool,
        address _uniV3Router,
        address _ramsesPool,
        address _weth,
        address _usdc,
        address _profitRecipient
    ) {
        require(_aavePool    != address(0), "BAD_AAVE");
        require(_uniV3Router != address(0), "BAD_UNI");
        require(_ramsesPool  != address(0), "BAD_RAMSES_POOL");
        require(_weth        != address(0), "BAD_WETH");
        require(_usdc        != address(0), "BAD_USDC");
        // WETH (0x82aF..) < USDC (0xaf88..) on Arbitrum → token0=WETH, token1=USDC
        require(_weth < _usdc, "TOKEN_SORT_ORDER");

        owner          = msg.sender;
        aavePool       = IPool(_aavePool);
        uniV3Router    = IUniV3SwapRouter(_uniV3Router);
        ramsesPool     = IRamsesV2Pool(_ramsesPool);
        WETH           = _weth;
        USDC           = _usdc;
        token0         = _weth;  // WETH is token0
        token1         = _usdc;  // USDC is token1
        profitRecipient = (_profitRecipient == address(0)) ? msg.sender : _profitRecipient;
    }

    // ── Owner entrypoint ──────────────────────────────────────────────────────
    function executeRamsesArb(
        address borrowAsset,
        uint256 amount,
        uint256 minProfit,
        uint256 amountOutMinA,
        uint256 amountOutMinB,
        uint8   direction,
        uint256 deadline
    ) external onlyOwner nonReentrant {
        // Boss ruling 2026-04-28: lock to USDC-only execution.
        // WETH direction causes 0x11 overflow inside Ramses pool tick math.
        // USDC direction confirmed profitable on fork.
        require(borrowAsset == USDC, "ONLY_USDC_SUPPORTED");
        require(amount    > 0,  "BAD_AMOUNT");
        require(minProfit > 0,  "MIN_PROFIT_REQUIRED");
        require(direction == DIRECTION_RAMSES_FIRST, "ONLY_USDC_RAMSES_FIRST");
        require(deadline >= block.timestamp, "DEADLINE_EXPIRED");

        emit ArbRequested(borrowAsset, amount, direction, minProfit);

        aavePool.flashLoanSimple(
            address(this), borrowAsset, amount,
            abi.encode(ArbParams(direction, minProfit, amountOutMinA, amountOutMinB, deadline)),
            0
        );
    }

    // ── Aave callback ─────────────────────────────────────────────────────────
    // NOT nonReentrant — Aave calls back inside executeRamsesArb's lock.
    // Secured by: msg.sender == aavePool AND initiator == address(this).
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(aavePool), "CALLER_NOT_AAVE_POOL");
        require(initiator  == address(this),     "BAD_INITIATOR");
        require(asset == USDC, "BAD_ASSET"); // USDC-only lock

        ArbParams memory p = abi.decode(params, (ArbParams));
        require(p.deadline >= block.timestamp, "CALLBACK_DEADLINE_EXPIRED");

        // Direction locked to RAMSES_FIRST by executeRamsesArb entrypoint.
        // _doUniFirst path removed — WETH direction disabled (pool overflow).
        _doRamsesFirst(asset, amount, p);

        uint256 repay        = amount + premium;
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        require(finalBalance >= repay + p.minProfit, "INSUFFICIENT_PROFIT");

        uint256 profit = finalBalance - repay;
        _safeApprove(asset, address(aavePool), repay);
        if (profit > 0) IERC20(asset).transfer(profitRecipient, profit);

        emit ArbExecuted(asset, amount, premium, finalBalance, profit);
        return true;
    }

    // ── Direction helpers ─────────────────────────────────────────────────────
    function _doRamsesFirst(address borrowAsset, uint256 amount, ArbParams memory p) internal {
        address mid = _other(borrowAsset);
        uint256 midAmt = _swapRamses(borrowAsset, mid, amount, p.amountOutMinA, p.deadline);
        _swapUniV3(mid, borrowAsset, midAmt, p.amountOutMinB, p.deadline);
    }

    function _doUniFirst(address borrowAsset, uint256 amount, ArbParams memory p) internal {
        address mid = _other(borrowAsset);
        uint256 midAmt = _swapUniV3(borrowAsset, mid, amount, p.amountOutMinA, p.deadline);
        _swapRamses(mid, borrowAsset, midAmt, p.amountOutMinB, p.deadline);
    }

    // ── UniV3 swap ────────────────────────────────────────────────────────────
    function _swapUniV3(
        address tokenIn, address tokenOut,
        uint256 amountIn, uint256 amountOutMin, uint256 deadline
    ) internal returns (uint256) {
        _safeApprove(tokenIn, address(uniV3Router), amountIn);
        return uniV3Router.exactInputSingle(IUniV3SwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn, tokenOut: tokenOut,
            fee: UNIV3_FEE, recipient: address(this),
            deadline: deadline, amountIn: amountIn,
            amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0
        }));
    }

    // ── Ramses direct pool swap ───────────────────────────────────────────────
    // No approval needed — we pay in the callback, not via transferFrom.
    // Output verified by pre/post balance delta.
    function _swapRamses(
        address tokenIn, address tokenOut,
        uint256 amountIn, uint256 amountOutMin, uint256 deadline
    ) internal returns (uint256 amountOut) {
        require(deadline >= block.timestamp, "RAMSES_DEADLINE");
        require(
            (tokenIn == token0 && tokenOut == token1) ||
            (tokenIn == token1 && tokenOut == token0),
            "RAMSES_BAD_PAIR"
        );

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        _doRamsesSwap(tokenIn, amountIn);
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        require(amountOut >= amountOutMin, "RAMSES_SLIPPAGE");
    }

    // ── Ramses direct swap execution (extracted to avoid stack-too-deep) ─────────
    // Boss Option A: dynamic sqrtPriceLimitX96 from slot0().sqrtPriceX96 ±2.5%
    // avoids MIN/MAX_SQRT_RATIO overflow in the pool's tick traversal math.
    function _doRamsesSwap(address tokenIn, uint256 amountIn) internal {
        bool zeroForOne = (tokenIn == token0);
        (uint160 sqrtPriceX96,,,,,, ) = ramsesPool.slot0();
        uint160 sqrtLimit = zeroForOne
            ? uint160(uint256(sqrtPriceX96) * 9750 / 10000)   // 2.5% below current
            : uint160(uint256(sqrtPriceX96) * 10250 / 10000); // 2.5% above current
        ramsesPool.swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            sqrtLimit,
            abi.encode(RamsesCallbackData({ tokenOwed: tokenIn }))
        );
    }

    // ── Ramses swap callback ──────────────────────────────────────────────────
    // Pool calls this after transferring output tokens to us.
    // We must pay the pool the input token amount it is owed.
    function ramsesV2SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        require(msg.sender == address(ramsesPool), "BAD_RAMSES_CALLBACK");
        require((amount0Delta > 0) != (amount1Delta > 0), "INVALID_DELTAS");

        RamsesCallbackData memory cb = abi.decode(data, (RamsesCallbackData));

        // Pay the pool whichever token it is owed
        require(cb.tokenOwed == token0 || cb.tokenOwed == token1, "CALLBACK_BAD_TOKEN");
        uint256 amountToPay = amount0Delta > 0
            ? uint256(amount0Delta)
            : uint256(amount1Delta);
        IERC20(cb.tokenOwed).transfer(address(ramsesPool), amountToPay);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _other(address asset) internal view returns (address) {
        if (asset == WETH) return USDC;
        if (asset == USDC) return WETH;
        revert("BAD_ASSET");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok1,) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
        require(ok1, "APPROVE_ZERO_FAILED");
        (bool ok2,) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok2, "APPROVE_FAILED");
    }

    // ── Owner maintenance ─────────────────────────────────────────────────────
    function setProfitRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "BAD_RECIPIENT");
        emit ProfitRecipientUpdated(profitRecipient, newRecipient);
        profitRecipient = newRecipient;
    }

    function emergencyWithdraw(address token, address to) external onlyOwner {
        require(to != address(0), "BAD_TO");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "ZERO_BALANCE");
        IERC20(token).transfer(to, bal);
        emit EmergencyWithdraw(token, to, bal);
    }

    function emergencyWithdrawETH(address payable to) external onlyOwner {
        require(to != address(0), "BAD_TO");
        uint256 bal = address(this).balance;
        require(bal > 0, "ZERO_BALANCE");
        (bool sent,) = to.call{value: bal}("");
        require(sent, "ETH_SEND_FAILED");
        emit EmergencyWithdraw(address(0), to, bal);
    }

    receive() external payable {}
}
