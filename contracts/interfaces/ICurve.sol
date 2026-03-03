// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICurvePool {
    // Standard exchange -- works for tricrypto on Arbitrum (use_eth defaults false)
    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    // Tricrypto variant with use_eth flag (set false to use WETH not native ETH)
    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 min_dy,
        bool    use_eth
    ) external returns (uint256);

    function get_dy(
        uint256 i,
        uint256 j,
        uint256 dx
    ) external view returns (uint256);
}
