// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CacheManagerAutomation} from '../core/CacheManagerAutomation.sol';

/// @notice Test-only harness exposing internal bid calculation behavior.
contract CacheManagerAutomationHarness is CacheManagerAutomation {
    constructor(
        address cacheManager,
        address arbWasmCache,
        address arbWasm
    ) CacheManagerAutomation(cacheManager, arbWasmCache, arbWasm) {}

    function calculateBidAmount(
        uint256 userMaxBid,
        uint256 bidIndex,
        uint192 minBid
    ) external view returns (uint192) {
        return _calculateBidAmount(userMaxBid, bidIndex, minBid);
    }
}
