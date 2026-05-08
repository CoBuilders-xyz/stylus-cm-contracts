// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Interface for the Cache Manager contract
interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
    function cacheSize() external view returns (uint64);
    function queueSize() external view returns (uint64);
    function decay() external view returns (uint64);
}

/// @notice Interface for the Arbitrum WASM Cache contract
interface IArbWasmCache {
    function codehashIsCached(bytes32 codehash) external view returns (bool);
}

/// @notice Interface for the Arbitrum WASM precompile (0x...0071)
interface IArbWasm {
    /// @notice Activates a Stylus program. Reverts if msg.value < dataFee.
    function activateProgram(
        address program
    ) external payable returns (uint16 version, uint256 dataFee);

    /// @notice Seconds remaining until the program expires (0 means expired).
    function programTimeLeft(
        address program
    ) external view returns (uint64);
}
