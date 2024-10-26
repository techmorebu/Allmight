// UnifiedFlashLoan.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IFlashLoanProvider {
    function executeFlashLoan(address tokenIn, address tokenOut, uint256 amount) external;
}

contract UnifiedFlashLoan {
    address public owner;
    IFlashLoanProvider public aave;
    IFlashLoanProvider public makerDAO;
    IFlashLoanProvider public uniswapV3;
    IFlashLoanProvider public balancer;

    constructor(
        address _aave,
        address _makerDAO,
        address _uniswapV3,
        address _balancer
    ) {
        owner = msg.sender;
        aave = IFlashLoanProvider(_aave);
        makerDAO = IFlashLoanProvider(_makerDAO);
        uniswapV3 = IFlashLoanProvider(_uniswapV3);
        balancer = IFlashLoanProvider(_balancer);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    function setFlashLoanProvider(
        string memory protocol,
        address providerAddress
    ) external onlyOwner {
        if (keccak256(bytes(protocol)) == keccak256(bytes("Aave"))) {
            aave = IFlashLoanProvider(providerAddress);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("MakerDAO"))) {
            makerDAO