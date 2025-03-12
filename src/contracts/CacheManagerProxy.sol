// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Interface for the Cache Manager contract
interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
}

/// @notice Interface for the Arbitrum WASM Cache contract
interface IArbWasmCache {
    function codehashIsCached(bytes32 codehash) external view returns (bool);
}

/// @title Cache Manager Proxy
/// @notice A proxy contract that manages user bids for contract caching in the Stylus VM
contract CacheManagerProxy is
    AutomationCompatibleInterface,
    Ownable,
    ReentrancyGuard
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // Constants
    uint256 private constant MAX_CONTRACTS_PER_USER = 50;
    uint256 private constant MIN_BID_AMOUNT = 1 wei;

    // State variables
    bool public paused;

    struct ContractConfig {
        address contractAddress;
        uint256 maxBid;
        uint256 lastBid;
        bool enabled;
    }

    struct UserConfig {
        ContractConfig[] contracts;
        uint256 balance;
    }

    ICacheManager public immutable cacheManager;
    IArbWasmCache public immutable arbWasmCache;

    mapping(address => UserConfig) public userConfig;
    EnumerableSet.AddressSet private userAddresses;

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
        uint256 bidAmount
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

    // Custom errors
    error InvalidAddress();
    error InvalidBid();
    error InsufficientBalance();
    error ContractNotFound();
    error NoContractsToRemove();
    error TooManyContracts();
    error ContractPaused();

    // Modifiers
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(
        address _cacheManager,
        address _arbWasmCache
    ) Ownable(msg.sender) {
        if (_cacheManager == address(0)) revert InvalidAddress();
        cacheManager = ICacheManager(_cacheManager);
        arbWasmCache = IArbWasmCache(_arbWasmCache);
    }

    /// @notice Pause contract operations
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause contract operations
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Allows owner to view all registered user addresses
    function getUserAddresses()
        external
        view
        onlyOwner
        returns (address[] memory)
    {
        return userAddresses.values();
    }

    /// @notice Inserts or updates a contract configuration
    function insertOrUpdateContract(
        address _contract,
        uint256 _maxBid
    ) external payable whenNotPaused {
        if (_contract == address(0)) revert InvalidAddress();
        if (_maxBid < MIN_BID_AMOUNT) revert InvalidBid();

        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        if (contracts.length >= MAX_CONTRACTS_PER_USER)
            revert TooManyContracts();

        // Try to update existing contract
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i].maxBid = _maxBid;
                _updateUserBalance(msg.sender, msg.value);
                emit ContractUpdated(msg.sender, _contract, _maxBid);
                return;
            }
        }

        // Add new contract
        contracts.push(
            ContractConfig({
                contractAddress: _contract,
                maxBid: _maxBid,
                lastBid: type(uint256).max,
                enabled: true
            })
        );

        _updateUserBalance(msg.sender, msg.value);
        userAddresses.add(msg.sender);
        emit ContractAdded(msg.sender, _contract, _maxBid);
    }

    /// @notice Places a bid for a contract
    function placeBid(address _contract, uint192 _bid) internal whenNotPaused {
        if (_contract == address(0)) revert InvalidAddress();

        uint192 minBid = cacheManager.getMinBid(_contract);
        if (_bid < minBid) revert InvalidBid();

        UserConfig storage user = userConfig[msg.sender];
        if (user.balance < _bid) revert InsufficientBalance();

        uint256 maxBid = 0;
        ContractConfig[] storage contracts = user.contracts;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                maxBid = contracts[i].maxBid;
                break;
            }
        }

        bool success = false;
        try cacheManager.placeBid{value: _bid}(_contract) {
            success = true;
            user.balance -= _bid;
            emit BidPlaced(msg.sender, _contract, _bid);
        } catch {
            // Handle the error
            emit BidError(msg.sender, _contract, _bid, "Bid placement failed");
        }

        emit BidDetails(
            msg.sender,
            _contract,
            _bid,
            minBid,
            maxBid,
            user.balance,
            success
        );
    }

    function placeBidExternal(
        address _contract,
        uint192 _bid
    ) external whenNotPaused {
        placeBid(_contract, _bid);
    }

    /// @notice Updates user balance and emits event
    function _updateUserBalance(address user, uint256 amount) internal {
        userConfig[user].balance += amount;
        emit BalanceUpdated(user, userConfig[user].balance);
    }

    /// @notice Removes a contract from user's configuration
    function removeContract(address _contract) external {
        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        if (contracts.length == 0) revert NoContractsToRemove();

        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i] = contracts[contracts.length - 1];
                contracts.pop();

                if (contracts.length == 0) {
                    userAddresses.remove(msg.sender);
                }

                emit ContractRemoved(msg.sender, _contract);
                return;
            }
        }

        revert ContractNotFound();
    }

    function removeAllContracts() external {
        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        uint256 length = contracts.length;
        if (length == 0) revert NoContractsToRemove();

        for (uint256 i = 0; i < length; i++) {
            emit ContractRemoved(msg.sender, contracts[i].contractAddress);
        }
        delete userConfig[msg.sender].contracts;
        userAddresses.remove(msg.sender);
    }

    // Chainlink Automation methods
    function checkUpkeep(
        bytes calldata
    ) external view returns (bool upkeepNeeded, bytes memory performData) {
        (upkeepNeeded, performData) = _checkContracts();
    }

    function performUpkeep(bytes calldata performData) external {
        uint256 totalContracts = abi.decode(performData, (uint256));
        uint256 successfulBids = 0;
        uint256 failedBids = 0;

        uint256 totalBids = 0;
        address[] memory users = userAddresses.values();

        for (
            uint256 u = 0;
            u < users.length && totalBids < totalContracts;
            u++
        ) {
            UserConfig storage userData = userConfig[users[u]];
            ContractConfig[] storage contracts = userData.contracts;

            for (
                uint256 i = 0;
                i < contracts.length && totalBids < totalContracts;
                i++
            ) {
                if (!_shouldBid(contracts[i])) continue;

                totalBids++;

                uint192 minBid = cacheManager.getMinBid(
                    contracts[i].contractAddress
                );
                if (userData.balance >= minBid) {
                    placeBid(contracts[i].contractAddress, minBid);
                    contracts[i].lastBid = minBid;
                    successfulBids++;
                } else {
                    failedBids++;
                }
            }
        }

        emit UpkeepPerformed(
            totalContracts,
            successfulBids,
            failedBids,
            block.timestamp
        );
    }

    /// @notice Internal function to check contracts for upkeep
    function _checkContracts() internal view returns (bool, bytes memory) {
        uint256 totalContracts = 0;
        address[] memory users = userAddresses.values();

        for (uint256 u = 0; u < users.length; u++) {
            ContractConfig[] memory contracts = userConfig[users[u]].contracts;
            for (uint256 i = 0; i < contracts.length; i++) {
                if (!_shouldBid(contracts[i])) continue;
                totalContracts++;
            }
        }

        return (totalContracts > 0, abi.encode(totalContracts));
    }

    /// @notice Internal function to check if a contract needs bidding
    function _shouldBid(
        ContractConfig memory config
    ) internal view returns (bool) {
        if (!config.enabled) return false;

        uint192 minBid = cacheManager.getMinBid(config.contractAddress);
        return
            minBid < config.maxBid &&
            !arbWasmCache.codehashIsCached(config.contractAddress.codehash) &&
            minBid < config.lastBid;
    }

    function getUserContracts(
        address _user
    ) external view returns (ContractConfig[] memory) {
        return userConfig[_user].contracts;
    }

    function getUserBalance() external view returns (uint256) {
        return userConfig[msg.sender].balance;
    }

    // Utility functions
    function withdrawBalance() external nonReentrant whenNotPaused {
        uint256 amount = userConfig[msg.sender].balance;
        if (amount == 0) revert InsufficientBalance();

        userConfig[msg.sender].balance = 0;

        // Update balance before transfer to prevent reentrancy
        emit BalanceUpdated(msg.sender, 0);

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert("Transfer failed");
    }

    function fundBalance() external payable whenNotPaused {
        if (msg.value < MIN_BID_AMOUNT) revert InvalidBid();
        _updateUserBalance(msg.sender, msg.value);
    }

    receive() external payable whenNotPaused {}
}
