// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// OpenZeppelin
import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {BiddingEscrow} from './BiddingEscrow.sol';

// Interfaces
import '../interfaces/IExternalContracts.sol';
import '../interfaces/ICacheManagerAutomation.sol';

/// @title Cache Manager Automation
/// @notice A automation contract that manages user bids for contract caching in the Stylus VM
contract CacheManagerAutomation is
    ICacheManagerAutomation,
    Ownable,
    ReentrancyGuard
{
    using EnumerableSet for EnumerableSet.AddressSet;
    BiddingEscrow public escrow;

    // ------------------------------------------------------------------------
    // Configuration state variables (modifiable by owner)
    // ------------------------------------------------------------------------
    uint256 public maxContractsPerUser;
    uint256 public minMaxBidAmount;
    uint256 public minFundAmount;
    uint256 public maxUserFunds;
    uint256 public maxBidsPerIteration;
    uint256 public maxUsersPerPage;
    uint256 public cacheThreshold;
    uint256 public horizonSeconds;
    uint192 public bidIncrement;

    // ------------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------------

    ICacheManager public cacheManager;
    IArbWasmCache public arbWasmCache;
    mapping(address => ContractConfig[]) public userContracts;
    EnumerableSet.AddressSet private usersWithContracts;

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    /// @notice Initializes the contract
    constructor(address _cacheManager, address _arbWasmCache) {
        if (_cacheManager == address(0)) revert InvalidAddress();
        if (_arbWasmCache == address(0)) revert InvalidAddress();

        cacheManager = ICacheManager(_cacheManager);
        arbWasmCache = IArbWasmCache(_arbWasmCache);
        escrow = new BiddingEscrow();

        // Initialize configuration parameters with default values
        maxContractsPerUser = 50;
        minMaxBidAmount = 1;
        minFundAmount = 1;
        maxUserFunds = 1 ether;
        maxBidsPerIteration = 50;
        maxUsersPerPage = 100;
        cacheThreshold = 98; // Start bidding when 98% full (10mb free for 512mb cache)
        horizonSeconds = 30 days; // Target 30 days to become competitive
        bidIncrement = 1; // Bid increment for uniqueness
    }

    // ------------------------------------------------------------------------
    // Emergency functions
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------------

    /// @notice Set maximum contracts per user
    /// @param _maxContractsPerUser New maximum contracts per user
    function setMaxContractsPerUser(
        uint256 _maxContractsPerUser
    ) external onlyOwner {
        require(
            _maxContractsPerUser > 0,
            'Max contracts per user must be greater than 0'
        );
        uint256 oldValue = maxContractsPerUser;
        maxContractsPerUser = _maxContractsPerUser;
        emit MaxContractsPerUserUpdated(oldValue, _maxContractsPerUser);
    }

    /// @notice Set minimum maximum bid amount
    /// @param _minMaxBidAmount New minimum maximum bid amount
    function setMinMaxBidAmount(uint256 _minMaxBidAmount) external onlyOwner {
        require(
            _minMaxBidAmount > 0,
            'Min max bid amount must be greater than 0'
        );
        uint256 oldValue = minMaxBidAmount;
        minMaxBidAmount = _minMaxBidAmount;
        emit MinMaxBidAmountUpdated(oldValue, _minMaxBidAmount);
    }

    /// @notice Set minimum fund amount
    /// @param _minFundAmount New minimum fund amount
    function setMinFundAmount(uint256 _minFundAmount) external onlyOwner {
        require(_minFundAmount > 0, 'Min fund amount must be greater than 0');
        uint256 oldValue = minFundAmount;
        minFundAmount = _minFundAmount;
        emit MinFundAmountUpdated(oldValue, _minFundAmount);
    }

    /// @notice Set maximum user funds
    /// @param _maxUserFunds New maximum user funds
    function setMaxUserFunds(uint256 _maxUserFunds) external onlyOwner {
        require(_maxUserFunds > 0, 'Max user funds must be greater than 0');
        uint256 oldValue = maxUserFunds;
        maxUserFunds = _maxUserFunds;
        emit MaxUserFundsUpdated(oldValue, _maxUserFunds);
    }

    /// @notice Set maximum bids per iteration
    /// @param _maxBidsPerIteration New maximum bids per iteration
    function setMaxBidsPerIteration(
        uint256 _maxBidsPerIteration
    ) external onlyOwner {
        require(
            _maxBidsPerIteration > 0,
            'Max bids per iteration must be greater than 0'
        );
        uint256 oldValue = maxBidsPerIteration;
        maxBidsPerIteration = _maxBidsPerIteration;
        emit MaxBidsPerIterationUpdated(oldValue, _maxBidsPerIteration);
    }

    /// @notice Set maximum users per page
    /// @param _maxUsersPerPage New maximum users per page
    function setMaxUsersPerPage(uint256 _maxUsersPerPage) external onlyOwner {
        require(
            _maxUsersPerPage > 0,
            'Max users per page must be greater than 0'
        );
        uint256 oldValue = maxUsersPerPage;
        maxUsersPerPage = _maxUsersPerPage;
        emit MaxUsersPerPageUpdated(oldValue, _maxUsersPerPage);
    }

    /// @notice Set cache threshold percentage
    /// @param _cacheThreshold New cache threshold (0-100)
    function setCacheThreshold(uint256 _cacheThreshold) external onlyOwner {
        require(_cacheThreshold <= 100, 'Cache threshold must be <= 100');
        uint256 oldValue = cacheThreshold;
        cacheThreshold = _cacheThreshold;
        emit CacheThresholdUpdated(oldValue, _cacheThreshold);
    }

    /// @notice Set horizon seconds for bid decay calculation
    /// @param _horizonSeconds New horizon seconds
    function setHorizonSeconds(uint256 _horizonSeconds) external onlyOwner {
        require(_horizonSeconds > 0, 'Horizon seconds must be greater than 0');
        uint256 oldValue = horizonSeconds;
        horizonSeconds = _horizonSeconds;
        emit HorizonSecondsUpdated(oldValue, _horizonSeconds);
    }

    /// @notice Set bid increment for uniqueness
    /// @param _bidIncrement New bid increment
    function setBidIncrement(uint192 _bidIncrement) external onlyOwner {
        require(_bidIncrement > 0, 'Bid increment must be greater than 0');
        uint192 oldValue = bidIncrement;
        bidIncrement = _bidIncrement;
        emit BidIncrementUpdated(oldValue, _bidIncrement);
    }

    // ------------------------------------------------------------------------
    // Contract externalfunctions (user)
    // ------------------------------------------------------------------------

    function insertContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external payable {
        if (_contract == address(0)) revert InvalidAddress(); // TODO allow on only stylus contracts
        if (_maxBid < minMaxBidAmount) revert InvalidBid();

        ContractConfig[] storage contracts = userContracts[msg.sender];
        if (contracts.length >= maxContractsPerUser) revert TooManyContracts();

        // Add new contract
        // Check if contract is already in the list
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                revert ContractAlreadyExists();
            }
        }

        // Add user to set if this is their first contract
        if (contracts.length == 0) {
            usersWithContracts.add(msg.sender);
        }

        contracts.push(
            ContractConfig({
                contractAddress: _contract,
                maxBid: _maxBid,
                enabled: _enabled
            })
        );
        _updateUserBalance(msg.sender, msg.value);
        emit ContractAdded(msg.sender, _contract, _maxBid);
    }

    function updateContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external {
        if (_contract == address(0)) revert InvalidAddress();
        if (_maxBid < 0) revert InvalidBid();

        ContractConfig[] storage contracts = userContracts[msg.sender];
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i].maxBid = _maxBid;
                contracts[i].enabled = _enabled;
                emit ContractUpdated(msg.sender, _contract, _maxBid);
                return;
            }
        }
    }

    function removeContract(address _contract) external {
        ContractConfig[] storage contracts = userContracts[msg.sender];
        if (contracts.length == 0) revert ContractNotFound();

        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i] = contracts[contracts.length - 1];
                contracts.pop();

                // Remove user from set if they have no more contracts
                if (contracts.length == 0) {
                    usersWithContracts.remove(msg.sender);
                }

                emit ContractRemoved(msg.sender, _contract);
                return;
            }
        }

        revert ContractNotFound();
    }

    function removeAllContracts() external {
        ContractConfig[] storage contracts = userContracts[msg.sender];
        uint256 length = contracts.length;
        if (length == 0) revert ContractNotFound();

        for (uint256 i = 0; i < length; i++) {
            emit ContractRemoved(msg.sender, contracts[i].contractAddress);
        }
        delete userContracts[msg.sender];

        // Remove user from set since they have no more contracts
        usersWithContracts.remove(msg.sender);
    }

    function getUserContracts()
        external
        view
        returns (ContractConfig[] memory)
    {
        return userContracts[msg.sender];
    }

    function fundBalance() external payable {
        if (msg.value < minFundAmount) revert InvalidFundAmount();

        uint256 currentBalance = escrow.depositsOf(msg.sender);
        if (currentBalance + msg.value > maxUserFunds)
            revert ExceedsMaxUserFunds();

        _updateUserBalance(msg.sender, msg.value);
    }

    function withdrawBalance() external nonReentrant {
        uint256 amount = escrow.depositsOf(msg.sender);
        if (amount == 0) revert InsufficientBalance();

        emit BalanceUpdated(msg.sender, 0);

        escrow.withdraw(payable(msg.sender));
    }

    function getUserBalance() external view returns (uint256) {
        return escrow.depositsOf(msg.sender);
    }

    receive() external payable {}

    // ------------------------------------------------------------------------
    // Contract external functions (operator)
    // ------------------------------------------------------------------------
    // Anyone can call this functions but the operator (owner) should be the only interested party on calling them

    function placeBids(BidRequest[] calldata _bidRequests) external {
        if (_bidRequests.length > maxBidsPerIteration) revert TooManyBids();
        for (uint256 i = 0; i < _bidRequests.length; i++) {
            BidResult memory result = _shouldBid(_bidRequests[i], i);
            if (!result.shouldBid) continue;
            _placeBid(
                _bidRequests[i].user,
                result.contractConfig,
                result.bidAmount
            );
        }
    }

    // May revert if too many. Better use paginated version.
    function getContracts() external view returns (UserContractsData[] memory) {
        uint256 userCount = usersWithContracts.length();
        UserContractsData[] memory allUserContracts = new UserContractsData[](
            userCount
        );

        for (uint256 i = 0; i < userCount; i++) {
            address user = usersWithContracts.at(i);
            allUserContracts[i] = UserContractsData({
                user: user,
                contracts: userContracts[user]
            });
        }

        return allUserContracts;
    }

    /// @notice Get contracts with pagination support
    /// @param offset Starting index for pagination
    /// @param limit Maximum number of users to return (0 = no limit, but capped at 100)
    /// @return userData Array of user contract data
    /// @return hasMore Whether there are more users beyond this page
    function getContractsPaginated(
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (UserContractsData[] memory userData, bool hasMore)
    {
        uint256 userCount = usersWithContracts.length();

        // Validate offset
        if (offset >= userCount) {
            return (new UserContractsData[](0), false);
        }

        // Cap limit to prevent abuse (max 100 users per call)
        uint256 maxLimit = maxUsersPerPage;
        if (limit == 0 || limit > maxLimit) {
            limit = maxLimit;
        }

        // Calculate actual number of users to return
        uint256 remainingUsers = userCount - offset;
        uint256 usersToReturn = remainingUsers < limit ? remainingUsers : limit;

        // Create result array
        userData = new UserContractsData[](usersToReturn);

        // Populate data
        for (uint256 i = 0; i < usersToReturn; i++) {
            address user = usersWithContracts.at(offset + i);
            userData[i] = UserContractsData({
                user: user,
                contracts: userContracts[user]
            });
        }

        // Check if there are more users
        hasMore = offset + usersToReturn < userCount;

        return (userData, hasMore);
    }

    /// @notice Get total number of users with contracts
    /// @return Total number of users
    function getTotalUsersCount() external view returns (uint256) {
        return usersWithContracts.length();
    }

    /// @notice Get user at specific index (for iteration purposes)
    /// @param index Index of the user
    /// @return User address at the given index
    function getUserAtIndex(uint256 index) external view returns (address) {
        require(index < usersWithContracts.length(), 'Index out of bounds');
        return usersWithContracts.at(index);
    }

    // ------------------------------------------------------------------------
    // Contract internal functions
    // ------------------------------------------------------------------------

    /// @dev Calculate bid amount using simplified decay-aware logic
    /// @param userMaxBid User's maximum willing bid amount
    /// @param bidIndex Index for uniqueness
    /// @param minBid Minimum bid amount
    /// @return calculatedBid The amount to bid
    function _calculateBidAmount(
        uint256 userMaxBid,
        uint256 bidIndex,
        uint192 minBid
    ) internal view returns (uint192 calculatedBid) {
        // Get cache utilization
        uint256 cacheUtilization = 0;
        try cacheManager.cacheSize() returns (uint64 capacity) {
            try cacheManager.queueSize() returns (uint64 currentSize) {
                if (capacity > 0) {
                    cacheUtilization =
                        (uint256(currentSize) * 100) /
                        uint256(capacity);
                }
            } catch {}
        } catch {}

        // CACHE NOT FULL CASE
        // If cache is not full, return 0.

        // Why not minBid + increment?
        // To avoid CMA users to compete with each other in a loop when cache is not full.
        // The threshold should be set so that the maxSizeContract can fit in the free space, if that condition is true, then minBid will be 0.
        // Otherwise, minBid will be != 0 but we will still bid 0 to make the bid fail and avoid competition.
        // A threshold of 98% for a 512mb Cache means that there is 10mb free space, enough to hold any contract.

        if (cacheUtilization < cacheThreshold) {
            return 0;
        }

        // CACHE FULL CASE (>98% usage)
        // We make the user spend the minimum between:
        // 1. The required bid so that the cache decays to minBid in "horizonSeconds"
        // 2. The user's maxBid

        // Calculate decay value: minBid + decayRate * horizonSeconds
        uint64 decayRate = 0;
        try cacheManager.decay() returns (uint64 rate) {
            decayRate = rate;
        } catch {
            decayRate = 0;
        }

        // Bid index * BID_INCREMENT is used to make the bid unique for all the contract bids in current block.

        uint256 decayValue = uint256(minBid) +
            (uint256(decayRate) * horizonSeconds) +
            bidIndex *
            bidIncrement;

        uint256 bidValue = decayValue < userMaxBid ? decayValue : userMaxBid;

        return uint192(bidValue);
    }

    /// @notice Internal function to check if a contract needs bidding
    function _shouldBid(
        BidRequest memory bidRequest,
        uint256 bidIndex
    ) internal view returns (BidResult memory) {
        address user = bidRequest.user;
        address contractAddress = bidRequest.contractAddress;

        // Negative cases returns false for skipping the bid
        // These are double checks just in case. Off-chain backend should send
        // only valid bids.

        // Are addresses valid?
        if (user == address(0) || contractAddress == address(0))
            return BidResult(false, ContractConfig(address(0), 0, false), 0);

        // Address is valid

        // Is contract already cached?
        if (arbWasmCache.codehashIsCached(contractAddress.codehash))
            return BidResult(false, ContractConfig(address(0), 0, false), 0);

        // Address is valid & contract is not cached

        // Is contract enabled and contract belongs to user?
        ContractConfig[] storage contracts = userContracts[user];
        for (uint256 j = 0; j < contracts.length; j++) {
            if (contracts[j].contractAddress == contractAddress) {
                // Is contract enabled?
                if (!contracts[j].enabled)
                    return BidResult(false, contracts[j], 0);

                // Calculate bid amount
                uint192 minBid = cacheManager.getMinBid(contractAddress);
                uint192 calculatedBid = _calculateBidAmount(
                    contracts[j].maxBid,
                    bidIndex,
                    minBid
                );

                // Check if bid is valid
                if (calculatedBid < minBid)
                    return BidResult(false, contracts[j], 0);

                // Check balance only if bidding > 0
                if (calculatedBid > 0) {
                    uint256 userBalance = escrow.depositsOf(user);
                    if (calculatedBid > userBalance)
                        return BidResult(false, contracts[j], 0);
                }

                return BidResult(true, contracts[j], calculatedBid);
            }
        }
        return BidResult(false, ContractConfig(address(0), 0, false), 0); // Contract not found
    }

    function _placeBid(
        address user,
        ContractConfig memory contractConfig,
        uint192 bidAmount
    ) internal {
        address contractAddress = contractConfig.contractAddress;
        uint256 maxBid = contractConfig.maxBid;

        if (bidAmount == 0) {
            // Free bid - place directly without escrow withdrawal
            try cacheManager.placeBid{value: 0}(contractAddress) {
                uint256 userBalance = escrow.depositsOf(user);
                emit BidPlaced(user, contractAddress, 0, maxBid, userBalance);
            } catch {
                emit BidError(
                    user,
                    contractAddress,
                    0,
                    'Free bid placement failed'
                );
            }
        } else {
            // Paid bid - withdraw from escrow and place bid
            try escrow.withdrawForBid(payable(user), bidAmount) {
                try cacheManager.placeBid{value: bidAmount}(contractAddress) {
                    uint256 userBalance = escrow.depositsOf(user);
                    emit BidPlaced(
                        user,
                        contractAddress,
                        bidAmount,
                        maxBid,
                        userBalance
                    );
                } catch {
                    // Return bid amount to user if bid placement fails
                    escrow.deposit{value: bidAmount}(user);
                    emit BidError(
                        user,
                        contractAddress,
                        bidAmount,
                        'Bid placement failed'
                    );
                }
            } catch {
                emit BidError(
                    user,
                    contractAddress,
                    bidAmount,
                    'Insufficient balance'
                );
            }
        }
    }

    /// @notice Updates user balance and emits event
    function _updateUserBalance(address user, uint256 amount) internal {
        escrow.deposit{value: amount}(user);
        emit BalanceUpdated(user, escrow.depositsOf(user));
    }
}
