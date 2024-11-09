// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OFABase {
    string public name = "OFA Base Contract";

    function setName(string memory newName) public {
        name = newName;
    }
}
