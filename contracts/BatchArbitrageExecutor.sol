// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashLoanProvider {
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external;
}

contract BatchArbitrageExecutor is Ownable {
    address public immutable flashLoanProvider;

    constructor(address _flashLoanProvider) {
        flashLoanProvider = _flashLoanProvider;
    }

    /**
     * @notice Executes an arbitrage trade using a flash loan.
     * @param tokenIn The address of the token to borrow.
     * @param tokenOut The address of the token to swap into.
     * @param amountIn The amount of tokenIn to borrow.
     */
    function executeArbitrage(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external onlyOwner {
        bytes memory data = abi.encode(tokenIn, tokenOut, amountIn);
        IFlashLoanProvider(flashLoanProvider).flashLoan(address(this), tokenIn, amountIn, data);
    }

    /**
     * @notice Callback function for the flash loan.
     * @param initiator The initiator of the flash loan.
     * @param token The token borrowed.
     * @param amount The amount borrowed.
     * @param fee The fee for the flash loan.
     * @param data Additional data for the flash loan.
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32) {
        require(msg.sender == flashLoanProvider, "Unauthorized lender");
        require(initiator == address(this), "Unauthorized initiator");

        // Decode the data
        (address tokenIn, address tokenOut, uint256 amountIn) = abi.decode(data, (address, address, uint256));

        // Step 1: Perform the swap
        uint256 amountOut = performSwap(tokenIn, tokenOut, amountIn);

        // Step 2: Repay the flash loan
        uint256 repaymentAmount = amount + fee;
        IERC20(tokenIn).transfer(flashLoanProvider, repaymentAmount);

        // Step 3: Transfer profits to the owner
        uint256 profit = amountOut - repaymentAmount;
        if (profit > 0) {
            IERC20(tokenOut).transfer(owner(), profit);
        }

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    /**
     * @notice Performs a token swap.
     * @param tokenIn The address of the token to swap from.
     * @param tokenOut The address of the token to swap to.
     * @param amountIn The amount of tokenIn to swap.
     * @return amountOut The amount of tokenOut received.
     */
    function performSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        // Implement DEX swap logic here (e.g., Uniswap, SushiSwap)
        // Placeholder: Assume a 1:1 swap rate
        amountOut = amountIn;
    }
}
