// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Interface for the Cache Manager contract
interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
}

/// @notice Interface for the Arbitrum WASM Cache contract
interface IArbWasmCache {
    function codehashIsCached(bytes32 codehash) external view returns (bool);
}
