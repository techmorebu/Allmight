// ArbitrageLogic.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./UnifiedFlashLoan.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

contract ArbitrageLogic is Ownable {
    UnifiedFlashLoan public flashLoanProvider;

    constructor(address _flashLoanProvider) {
        flashLoan