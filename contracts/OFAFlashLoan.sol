// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlashLoanReceiverBaseV3} from "@aave/protocol-v3/contracts/flashloan/base/FlashLoanReceiverBaseV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OFAFlashLoan is FlashLoanReceiverBaseV3 {
    address private owner;

    constructor(IPoolAddressesProvider _addressProvider) FlashLoanReceiverBaseV3(_addressProvider) {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }

    function requestFlashLoan(address asset, uint256 amount) external onlyOwner {
        address receiverAddress = address(this);
        bytes memory params = ""; // Additional parameters can be passed if needed
        uint16 referralCode = 0;

        POOL.flashLoanSimple(receiverAddress, asset, amount, params, referralCode);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Example: Just repaying the loan + premium
        uint256 amountOwing = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwing);
        return true;
    }
}
