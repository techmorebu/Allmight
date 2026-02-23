// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICurvePool {
    // exchange(i, j, dx, min_dy)
    // i = index of token to sell
    // j = index of token to buy
    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    function get_dy(
        uint256 i,
        uint256 j,
        uint256 dx
    ) external view returns (uint256);
}
