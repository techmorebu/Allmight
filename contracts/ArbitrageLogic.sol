// ArbitrageLogic.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDEX {
    function getExpectedReturn(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external returns (uint256);
}

contract ArbitrageLogic {
    address public owner;
    address public dexA;
    address public dexB;
    address public dexC;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor(address _dexA, address _dexB, address _dexC) {
        owner = msg.sender;
        dexA = _dexA;
        dexB = _dexB;
        dexC = _dexC;
    }

    function updateDEXAddress(address _dexA, address _dexB, address _dexC) external onlyOwner {
        dexA = _dexA;
        dexB = _dexB;
        dexC = _dexC;
    }

    function standardArbitrage(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minProfit
    ) external onlyOwner returns (bool success) {
        uint256 gasStart = gasleft();
        
        uint256 amountOutA = IDEX(dexA).getExpectedReturn(tokenIn, tokenOut, amountIn);
        uint256 amountOutB = IDEX(dexB).getExpectedReturn(tokenIn, tokenOut, amountIn);

        if (amountOutA > amountOutB) {
            uint256 finalAmount = IDEX(dexA).swap(tokenIn, tokenOut, amountIn, amountOutA);
            require(finalAmount >= amountOutB + minProfit, "Arbitrage failed: No profit on dexA to dexB");
            success = true;
        } else if (amountOutB > amountOutA) {
            uint256 finalAmount = IDEX(dexB).swap(tokenIn, tokenOut, amountIn, amountOutB);
            require(finalAmount >= amountOutA + minProfit, "Arbitrage failed: No profit on dexB to dexA");
            success = true;
        } else {
            revert("Arbitrage opportunity not found");
        }

        uint256 gasUsed = gasStart - gasleft();
        require(finalAmount - amountIn > gasUsed * tx.gasprice, "Arbitrage failed: Insufficient profit after gas costs");
    }

    function triangularArbitrage(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        uint256 minProfit
    ) external onlyOwner returns (bool success) {
        uint256 gasStart = gasleft();
        
        uint256 amountOutAB = IDEX(dexA).getExpectedReturn(tokenA, tokenB, amountIn);
        uint256 amountOutBC = IDEX(dexB).getExpectedReturn(tokenB, tokenC, amountOutAB);
        uint256 amountOutCA = IDEX(dexC).getExpectedReturn(tokenC, tokenA, amountOutBC);

        require(amountOutCA > amountIn + minProfit, "Arbitrage failed: No profit in triangular trade");

        uint256 intermediateAmountB = IDEX(dexA).swap(tokenA, tokenB, amountIn, amountOutAB);
        uint256 intermediateAmountC = IDEX(dexB).swap(tokenB, tokenC, intermediateAmountB, amountOutBC);
        uint256 finalAmount = IDEX(dexC).swap(tokenC, tokenA, intermediateAmountC, amountOutCA);

        require(finalAmount > amountIn + minProfit, "Arbitrage failed: Insufficient final amount");

        uint256 gasUsed = gasStart - gasleft();
        require(finalAmount - amountIn > gasUsed * tx.gasprice, "Arbitrage failed: Insufficient profit after gas costs");

        success = true;
    }

    function withdrawFunds(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        owner = newOwner;
    }
}
