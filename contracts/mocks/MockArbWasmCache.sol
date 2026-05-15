// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IArbWasmCache} from '../interfaces/IExternalContracts.sol';

contract MockArbWasmCache is IArbWasmCache {
    mapping(bytes32 => bool) public cached;

    function setCached(bytes32 codehash, bool isCached) external {
        cached[codehash] = isCached;
    }

    function codehashIsCached(
        bytes32 codehash
    ) external view override returns (bool) {
        return cached[codehash];
    }
}
