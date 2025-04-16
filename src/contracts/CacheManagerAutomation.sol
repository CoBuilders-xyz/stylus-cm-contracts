// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// Chainlink
import {AutomationCompatibleInterface} from '@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol';

// OpenZeppelin
import {Initializable} from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import {UUPSUpgradeable} from '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import {OwnableUpgradeable} from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import {ReentrancyGuardUpgradeable} from '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import {BiddingEscrow} from './BiddingEscrow.sol';

// Interfaces
import './interfaces/IExternalContracts.sol';
import './interfaces/ICacheManagerAutomation.sol';

/// @title Cache Manager Automation
/// @notice A automation contract that manages user bids for contract caching in the Stylus VM
contract CacheManagerAutomation is
    ICacheManagerAutomation,
    AutomationCompatibleInterface,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    BiddingEscrow public escrow;

    // ------------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------------

    uint256 private constant MAX_CONTRACTS_PER_USER = 50;
    uint256 private constant MIN_BID_AMOUNT = 1 wei; // TODO: Check if this is correct

    // ------------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------------

    bool public paused;

    ICacheManager public cacheManager;
    IArbWasmCache public arbWasmCache;

    mapping(address => UserConfig) public userConfig;
    EnumerableSet.AddressSet private userAddresses;

    // ------------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------------

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ------------------------------------------------------------------------
    // Initializer
    // ------------------------------------------------------------------------

    /// @notice Initializes the upgradeable contract
    function initialize(
        address _cacheManager,
        address _arbWasmCache
    ) public initializer {
        if (_cacheManager == address(0)) revert InvalidAddress();
        if (_arbWasmCache == address(0)) revert InvalidAddress();

        __Ownable_init(); // Upgradeable Ownable
        __ReentrancyGuard_init(); // Upgradeable Reentrancy Guard

        cacheManager = ICacheManager(_cacheManager);
        arbWasmCache = IArbWasmCache(_arbWasmCache);
        escrow = new BiddingEscrow();
    }

    // @notice Required for UUPS upgrades
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    // ------------------------------------------------------------------------
    // Emergency functions
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Contract functions
    // ------------------------------------------------------------------------

    /// @notice Inserts or updates a contract configuration
    function insertOrUpdateContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
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
                contracts[i].enabled = _enabled;
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
                enabled: _enabled
            })
        );

        _updateUserBalance(msg.sender, msg.value);
        userAddresses.add(msg.sender);
        emit ContractAdded(msg.sender, _contract, _maxBid);
    }

    /// @notice Updates user balance and emits event
    function _updateUserBalance(address user, uint256 amount) internal {
        escrow.deposit{value: amount}(user);
        emit BalanceUpdated(user, escrow.depositsOf(user));
    }

    /// @notice Removes a contract from user's configuration
    function removeContract(address _contract) external {
        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        if (contracts.length == 0) revert ContractNotFound();

        bool found = false;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                found = true;
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
        if (length == 0) revert ContractNotFound();

        for (uint256 i = 0; i < length; i++) {
            emit ContractRemoved(msg.sender, contracts[i].contractAddress);
        }
        delete userConfig[msg.sender].contracts;
        userAddresses.remove(msg.sender);
    }

    function setContractEnabled(address _contract, bool _enabled) external {
        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i].enabled = _enabled;
                return;
            }
        }
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
            address user = users[u];
            UserConfig storage userData = userConfig[user];
            ContractConfig[] storage contracts = userData.contracts;
            uint256 userBalance = escrow.depositsOf(user);

            for (
                uint256 i = 0;
                i < contracts.length && totalBids < totalContracts;
                i++
            ) {
                if (!_shouldBid(contracts[i])) continue;

                totalBids++;
                address contractAddress = contracts[i].contractAddress;

                // Get current minimum bid
                uint192 minBid = cacheManager.getMinBid(contractAddress);
                emit MinBidCheck(contractAddress, minBid);
                uint192 bidAmount = minBid + 1; // TODO: Check why +1

                // Withdraw bid amount from escrow
                try escrow.withdrawForBid(payable(user), bidAmount) {
                    // Check if bid amount is within max bid and user balance
                    if (
                        bidAmount <= contracts[i].maxBid &&
                        userBalance >= bidAmount
                    ) {
                        // Place bid
                        try
                            cacheManager.placeBid{value: bidAmount}(
                                contractAddress
                            )
                        {
                            contracts[i].lastBid = bidAmount;
                            successfulBids++;
                            emit BidPlaced(
                                user,
                                contractAddress,
                                bidAmount,
                                minBid,
                                contracts[i].maxBid,
                                userBalance
                            );

                            // Get the new minimum bid after successful bid placement
                            minBid = cacheManager.getMinBid(contractAddress);
                        } catch {
                            // Return bid amount to user if bid placement fails
                            escrow.deposit{value: bidAmount}(user);

                            emit BidError(
                                user,
                                contractAddress,
                                bidAmount,
                                'Bid placement failed'
                            );
                            failedBids++;
                        }
                    } else {
                        failedBids++;
                    }
                } catch {
                    emit BidError(
                        user,
                        contractAddress,
                        bidAmount,
                        'Escrow withdrawal failed'
                    );
                    failedBids++;
                    break;
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
        // TODO: Should this be owner only? Actually we should use msg.sender
        return userConfig[_user].contracts;
    }

    function getUserBalance() external view returns (uint256) {
        return escrow.depositsOf(msg.sender);
    }

    function withdrawBalance() external nonReentrant whenNotPaused {
        uint256 amount = escrow.depositsOf(msg.sender);
        if (amount == 0) revert InsufficientBalance();

        // Update balance before transfer to prevent reentrancy
        emit BalanceUpdated(msg.sender, 0);

        escrow.withdraw(payable(msg.sender));
    }

    function fundBalance() external payable whenNotPaused {
        if (msg.value < MIN_BID_AMOUNT) revert InvalidBid();
        _updateUserBalance(msg.sender, msg.value);
    }

    receive() external payable whenNotPaused {}
}
