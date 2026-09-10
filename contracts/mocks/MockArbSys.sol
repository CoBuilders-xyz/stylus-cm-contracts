// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract MockArbSys {
    function arbBlockNumber() external view returns (uint256) {
        return block.number;
    }
}
