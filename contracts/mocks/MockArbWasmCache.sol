// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IArbWasmCache} from '../interfaces/IExternalContracts.sol';

contract MockArbWasmCache is IArbWasmCache {
    error CacheCheckCalled();

    mapping(bytes32 => bool) public cached;
    bool public revertOnCheck;

    function setCached(bytes32 codehash, bool isCached) external {
        cached[codehash] = isCached;
    }

    function setRevertOnCheck(bool shouldRevert) external {
        revertOnCheck = shouldRevert;
    }

    function codehashIsCached(
        bytes32 codehash
    ) external view override returns (bool) {
        if (revertOnCheck) revert CacheCheckCalled();
        return cached[codehash];
    }
}
