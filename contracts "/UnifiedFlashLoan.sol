// UnifiedFlashLoan.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFlashLoanProvider {
    function executeFlashLoan(
        address tokenIn,
        address tokenOut,
        uint256 amount
    ) external;
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

    function updateProviderAddress(
        string memory protocol,
        address newAddress
    ) external onlyOwner {
        if (keccak256(bytes(protocol)) == keccak256(bytes("Aave"))) {
            aave = IFlashLoanProvider(newAddress);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("MakerDAO"))) {
            makerDAO = IFlashLoanProvider(newAddress);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("UniswapV3"))) {
            uniswapV3 = IFlashLoanProvider(newAddress);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("Balancer"))) {
            balancer = IFlashLoanProvider(newAddress);
        } else {
            revert("Unsupported protocol");
        }
    }

    function executeFlashLoan(
        string memory protocol,
        address tokenIn,
        address tokenOut,
        uint256 amount
    ) external onlyOwner {
        if (keccak256(bytes(protocol)) == keccak256(bytes("Aave"))) {
            aave.executeFlashLoan(tokenIn, tokenOut, amount);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("MakerDAO"))) {
            makerDAO.executeFlashLoan(tokenIn, tokenOut, amount);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("UniswapV3"))) {
            uniswapV3.executeFlashLoan(tokenIn, tokenOut, amount);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("Balancer"))) {
            balancer.executeFlashLoan(tokenIn, tokenOut, amount);
        } else {
            revert("Unsupported protocol");
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        owner = newOwner;
    }
}
