// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ICacheManagerAutomation
/// @notice Interface for the Cache Manager Automation contract
interface ICacheManagerAutomation {
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
        uint192 bidAmount;
    }
    struct UserContractsData {
        address user;
        ContractConfig[] contracts;
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

    // Parameter change events
    event MaxContractsPerUserUpdated(uint256 oldValue, uint256 newValue);
    event MinMaxBidAmountUpdated(uint256 oldValue, uint256 newValue);
    event MinFundAmountUpdated(uint256 oldValue, uint256 newValue);
    event MaxUserFundsUpdated(uint256 oldValue, uint256 newValue);
    event MaxBidsPerIterationUpdated(uint256 oldValue, uint256 newValue);
    event MaxUsersPerPageUpdated(uint256 oldValue, uint256 newValue);
    event CacheThresholdUpdated(uint256 oldValue, uint256 newValue);
    event HorizonSecondsUpdated(uint256 oldValue, uint256 newValue);
    event BidIncrementUpdated(uint192 oldValue, uint192 newValue);

    // Debug events
    event DebugBidCheck(
        address indexed user,
        address indexed contractAddress,
        string step
    );
    event DebugMinBidFetch(
        address indexed contractAddress,
        uint192 minBid,
        bool success
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
    function getContracts() external view returns (UserContractsData[] memory);
    function getContractsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (UserContractsData[] memory userData, bool hasMore);
    function getTotalUsersCount() external view returns (uint256);
    function getUserAtIndex(uint256 index) external view returns (address);

    // Parameter setter functions
    function setMaxContractsPerUser(uint256 _maxContractsPerUser) external;
    function setMinMaxBidAmount(uint256 _minMaxBidAmount) external;
    function setMinFundAmount(uint256 _minFundAmount) external;
    function setMaxUserFunds(uint256 _maxUserFunds) external;
    function setMaxBidsPerIteration(uint256 _maxBidsPerIteration) external;
    function setMaxUsersPerPage(uint256 _maxUsersPerPage) external;
    function setCacheThreshold(uint256 _cacheThreshold) external;
    function setHorizonSeconds(uint256 _horizonSeconds) external;
    function setBidIncrement(uint192 _bidIncrement) external;
}
