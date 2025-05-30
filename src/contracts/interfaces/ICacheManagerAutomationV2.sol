// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ICacheManagerAutomation
/// @notice Interface for the Cache Manager Automation contract
interface ICacheManagerAutomationV2 {
    // Structs
    struct ContractConfig {
        address contractAddress;
        uint256 maxBid;
        bool enabled;
    }
    struct BidRequest {
        address user;
        address contractAddress;
    }
    struct BidResult {
        bool shouldBid;
        ContractConfig contractConfig;
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
    error ContractAlreadyExists();
    error ExceedsMaxUserFunds();
    error InvalidFundAmount();
    error TooManyBids();

    // Functions
    function insertContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external payable;
    function updateContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external;
    function removeContract(address _contract) external;
    function removeAllContracts() external;
    function getUserContracts() external view returns (ContractConfig[] memory);
    function fundBalance() external payable;
    function withdrawBalance() external;
    function getUserBalance() external view returns (uint256);
    function placeBids(BidRequest[] calldata _bidRequests) external;
}
