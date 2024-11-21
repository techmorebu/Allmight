// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleStorage {
    uint256 private data;

    // Event to log data updates
    event DataUpdated(uint256 oldData, uint256 newData);

    // Function to set data
    function set(uint256 _data) public {
        uint256 oldData = data;
        data = _data;
        emit DataUpdated(oldData, _data);
    }

    // Function to get data
    function get() public view returns (uint256) {
        return data;
    }
}
