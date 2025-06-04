// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// OpenZeppelin
import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
// OpenZeppelin
import {Initializable} from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import {UUPSUpgradeable} from '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import {OwnableUpgradeable} from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import {ReentrancyGuardUpgradeable} from '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import {BiddingEscrow} from './BiddingEscrow.sol';

// Interfaces
import './interfaces/IExternalContracts.sol';
import './interfaces/ICacheManagerAutomationV2.sol';

/// @title Cache Manager Automation
/// @notice A automation contract that manages user bids for contract caching in the Stylus VM
contract CacheManagerAutomationV2 is
    ICacheManagerAutomationV2,
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
    uint256 private constant MIN_MAX_BID_AMOUNT = 1;
    uint256 private constant MIN_FUND_AMOUNT = 1;
    uint256 private constant MAX_USER_FUNDS = 1 ether;
    uint256 private constant MAX_BIDS_PER_ITERATION = 50;

    // ------------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------------

    ICacheManager public cacheManager;
    IArbWasmCache public arbWasmCache;
    mapping(address => ContractConfig[]) public userContracts;
    EnumerableSet.AddressSet private usersWithContracts;

    // ------------------------------------------------------------------------
    // Structs
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------
    // Contract externalfunctions (user)
    // ------------------------------------------------------------------------

    function insertContract(
        address _contract,
        uint256 _maxBid,
        bool _enabled
    ) external payable {
        if (_contract == address(0)) revert InvalidAddress(); // TODO allow on only stylus contracts
        if (_maxBid < MIN_MAX_BID_AMOUNT) revert InvalidBid();

        ContractConfig[] storage contracts = userContracts[msg.sender];
        if (contracts.length >= MAX_CONTRACTS_PER_USER)
            revert TooManyContracts();

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
        if (msg.value < MIN_FUND_AMOUNT) revert InvalidFundAmount();

        uint256 currentBalance = escrow.depositsOf(msg.sender);
        if (currentBalance + msg.value > MAX_USER_FUNDS)
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
        if (_bidRequests.length > MAX_BIDS_PER_ITERATION) revert TooManyBids();
        for (uint256 i = 0; i < _bidRequests.length; i++) {
            BidResult memory result = _shouldBid(_bidRequests[i]);
            if (!result.shouldBid) continue;
            _placeBid(_bidRequests[i].user, result.contractConfig);
        }
    }

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

    // ------------------------------------------------------------------------
    // Contract internal functions
    // ------------------------------------------------------------------------

    /// @notice Internal function to check if a contract needs bidding
    function _shouldBid(
        BidRequest memory bidRequest
    ) internal view returns (BidResult memory) {
        address user = bidRequest.user;
        address contractAddress = bidRequest.contractAddress;

        // Negative cases returns false for skipping the bid
        // These are double checks just in case. Off-chain backend should send
        // only valid bids.

        // Are addresses valid?
        if (user == address(0) || contractAddress == address(0))
            return BidResult(false, ContractConfig(address(0), 0, false));

        // Address is valid

        // Is contract already cached?
        if (arbWasmCache.codehashIsCached(contractAddress.codehash))
            return BidResult(false, ContractConfig(address(0), 0, false));

        // Address is valid & contract is not cached

        // Is contract enabled and contract belongs to user?
        ContractConfig[] storage contracts = userContracts[user];
        for (uint256 j = 0; j < contracts.length; j++) {
            if (contracts[j].contractAddress == contractAddress) {
                // Is contract enabled?
                if (!contracts[j].enabled)
                    return BidResult(false, contracts[j]);

                // Address is valid & contract is not cached & contract belongs to user & contract is enabled

                // TODO when bidding strategy is defined, fund checks will change.

                // Is bid amount within max bid?
                uint192 minBid = cacheManager.getMinBid(contractAddress);
                if (minBid > contracts[j].maxBid)
                    return BidResult(false, contracts[j]);

                // Address is valid & contract is not cached & contract belongs to user & contract is enabled & minBid <= maxBid

                // Is user balance enough to bid?
                uint256 userBalance = escrow.depositsOf(user);
                if (minBid > userBalance) return BidResult(false, contracts[j]);
                // Address is valid & contract is not cached & contract belongs to user & contract is enabled & minBid <= maxBid & userBalance => minBid

                return BidResult(true, contracts[j]);
            }
        }
        return BidResult(false, ContractConfig(address(0), 0, false)); // Contract not found
    }

    function _placeBid(
        address user,
        ContractConfig memory contractConfig
    ) internal {
        address contractAddress = contractConfig.contractAddress;
        uint256 maxBid = contractConfig.maxBid;
        uint192 minBid = cacheManager.getMinBid(contractAddress);

        try escrow.withdrawForBid(payable(user), minBid) {
            try cacheManager.placeBid{value: minBid}(contractAddress) {
                uint256 userBalance = escrow.depositsOf(user);
                emit BidPlaced(
                    user,
                    contractAddress,
                    minBid,
                    maxBid,
                    userBalance
                );
            } catch {
                // Return bid amount to user if bid placement fails
                escrow.deposit{value: minBid}(user);
                emit BidError(
                    user,
                    contractAddress,
                    minBid,
                    'Bid placement failed'
                );
            }
        } catch {
            emit BidError(
                user,
                contractAddress,
                minBid,
                'Insufficient balance'
            );
        }
    }

    /// @notice Updates user balance and emits event
    function _updateUserBalance(address user, uint256 amount) internal {
        escrow.deposit{value: amount}(user);
        emit BalanceUpdated(user, escrow.depositsOf(user));
    }
}
