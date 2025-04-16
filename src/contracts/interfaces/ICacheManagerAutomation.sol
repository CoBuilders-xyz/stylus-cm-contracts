// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title ICacheManagerAutomation
/// @notice Interface for the Cache Manager Automation contract
interface ICacheManagerAutomation {
    // Structs
    struct ContractConfig {
        address contractAddress;
        uint256 maxBid;
        uint256 lastBid;
        bool enabled;
    }

    // Events
    event ContractAdded(
        address indexed user,
        address indexed contractAddress,
        uint256 maxBid
    );
    event ContractUpdated(
        address indexed user,
        address indexed contractAddress,
        uint256 maxBid
    );
    event BidPlaced(
        address indexed user,
        address indexed contractAddress,
        uint256 bidAmount,
        uint256 minBid,
        uint256 maxBid,
        uint256 userBalance
    );
    event ContractRemoved(
        address indexed user,
        address indexed contractAddress
    );
    event BalanceUpdated(address indexed user, uint256 newBalance);
    event BidAttempted(
        address indexed user,
        address indexed contractAddress,
        uint256 bid,
        bool success
    );
    event BidError(
        address indexed user,
        address indexed contractAddress,
        uint256 bid,
        string reason
    );
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event ContractOperationPerformed(
        address indexed user,
        address indexed contractAddress,
        string operation,
        uint256 timestamp
    );
    event BidDetails(
        address indexed user,
        address indexed contractAddress,
        uint256 bidAmount,
        uint256 minBid,
        uint256 maxBid,
        uint256 userBalance,
        bool success
    );
    event MinBidCheck(address indexed contractAddress, uint256 minBid);

    event UpkeepPerformed(
        uint256 totalContracts,
        uint256 successfulBids,
        uint256 failedBids,
        uint256 timestamp
    );
    event UserBalanceOperation(
        address indexed user,
        string operation,
        uint256 amount,
        uint256 newBalance,
        uint256 timestamp
    );

    // Errors
    error InvalidAddress();
    error InvalidBid();
    error InsufficientBalance();
    error ContractNotFound();
    error TooManyContracts();
    error ContractPaused();

    // Functions
    function initialize(address _cacheManager, address _arbWasmCache) external;
    function pause() external;
    function unpause() external;
    function getUserAddresses() external view returns (address[] memory);
    function insertOrUpdateContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external payable;
    function removeContract(address _contract) external;
    function removeAllContracts() external;
    function setContractEnabled(address _contract, bool _enabled) external;
    function getUserContracts() external view returns (ContractConfig[] memory);
    function getUserBalance() external view returns (uint256);
    function withdrawBalance() external;
    function fundBalance() external payable;
}
