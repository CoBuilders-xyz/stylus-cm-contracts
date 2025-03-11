// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
}

interface IArbWasmCache {
    function codehashIsCached(bytes32 codehash) external view returns (bool);
}

contract CacheManagerProxy {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Variables
    struct ContractConfig {
        address contractAddress;
        uint256 maxBid;
        uint256 lastBid; // Track the last successful bid
        bool enabled;
    }
    struct UserConfig {
        ContractConfig[] contracts;
        uint256 balance;
    }
    ICacheManager public immutable cacheManager;
    IArbWasmCache public immutable arbWasmCache;
    address public owner;

    mapping(address => UserConfig) public userConfig;
    EnumerableSet.AddressSet private userAddresses;

    // Events
    event ContractAdded(
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

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not contract owner");
        _;
    }

    // Admin Methods
    function getUserAddresses()
        external
        view
        onlyOwner
        returns (address[] memory)
    {
        return userAddresses.values();
    }

    // Methods
    constructor(address _cacheManager, address _arbWasmCache) {
        require(_cacheManager != address(0), "Invalid CacheManager address");
        cacheManager = ICacheManager(_cacheManager);
        arbWasmCache = IArbWasmCache(_arbWasmCache);
        owner = msg.sender;
    }

    // TODO Add Testing for userBalance and already exist contract.
    function insertOrUpdateContract(
        address _contract,
        uint256 _maxBid
    ) external payable {
        require(_contract != address(0), "Invalid contract address");
        require(_maxBid > 0, "Max bid must be greater than zero");

        UserConfig storage user = userConfig[msg.sender];
        ContractConfig[] storage contracts = user.contracts;
        bool found = false;

        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i].maxBid = _maxBid; // Update maxBid if exists
                found = true;
                break;
            }
        }

        // If contract does not exist, add it
        if (!found) {
            contracts.push(
                ContractConfig({
                    contractAddress: _contract,
                    maxBid: _maxBid,
                    lastBid: type(uint256).max,
                    enabled: true
                })
            );
        }

        user.balance += msg.value;
        userAddresses.add(msg.sender); // Track user address in EnumerableSet

        emit ContractAdded(msg.sender, _contract, _maxBid);
    }
    function getUserContracts(
        address _user
    ) external view returns (ContractConfig[] memory) {
        return userConfig[_user].contracts;
    }
    //TODO validate if this info needs to be public
    function getUserBalance() external view returns (uint256) {
        return userConfig[msg.sender].balance;
    }
    function removeContract(address _contract) external {
        require(_contract != address(0), "Invalid contract address");

        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        require(contracts.length > 0, "No contracts to remove");

        bool found = false;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                contracts[i] = contracts[contracts.length - 1]; // Swap with last element
                contracts.pop(); // Remove last element
                found = true;
                break;
            }
        }

        require(found, "Contract not found");

        // If user has no contracts left, remove from tracking
        if (contracts.length == 0) {
            userAddresses.remove(msg.sender);
        }

        // Emit event after successful removal
        emit ContractRemoved(msg.sender, _contract);
    }
    function removeAllContracts() external {
        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        uint256 length = contracts.length;
        require(length > 0, "No contracts to remove");

        // Emit event for each contract before deleting them
        for (uint256 i = 0; i < length; i++) {
            emit ContractRemoved(msg.sender, contracts[i].contractAddress);
        }
        // Clear user's contract list
        delete userConfig[msg.sender].contracts;
        userAddresses.remove(msg.sender);
    }
    function placeUserBid(
        address _user,
        address _contract,
        uint256 _bid
    ) internal returns (bool) {
        uint192 minBid = cacheManager.getMinBid(_contract);
        require(_bid >= minBid, "Insufficient bid amount");

        // Check balance before attempting bid to prevent unnecessary gas consumption
        uint256 maxPossibleGas = 100000; // Set a reasonable gas limit estimate
        uint256 maxGasCost = maxPossibleGas * tx.gasprice;
        require(
            userConfig[_user].balance >= _bid + maxGasCost,
            "Insufficient balance for bid and potential gas"
        );

        uint256 initialGas = gasleft();

        try cacheManager.placeBid{value: _bid}(_contract) {
            // Bid successful - calculate actual gas used
            uint256 gasUsed = initialGas - gasleft();
            uint256 actualGasCost = gasUsed * tx.gasprice;

            // Deduct bid amount and actual gas cost
            userConfig[_user].balance -= (_bid + actualGasCost);

            // Update lastBid when successful
            for (uint256 i = 0; i < userConfig[_user].contracts.length; i++) {
                if (
                    userConfig[_user].contracts[i].contractAddress == _contract
                ) {
                    userConfig[_user].contracts[i].lastBid = _bid;
                    break;
                }
            }

            emit BidPlaced(_user, _contract, _bid);
            return true;
        } catch {
            // If bid fails (e.g., "Already Cached"):
            // 1. The bid amount is automatically returned (due to revert)
            // 2. We still need to charge for gas used up to the revert
            uint256 gasUsed = initialGas - gasleft();
            uint256 actualGasCost = gasUsed * tx.gasprice;

            // Only deduct the gas cost for the failed attempt
            userConfig[_user].balance -= actualGasCost;
            return false;
        }
    }

    function checkUpkeep(
        bytes calldata /* checkData */
    ) external view returns (bool upkeepNeeded, bytes memory performData) {
        address[] memory users = userAddresses.values();
        uint256 totalContracts = 0;

        for (uint256 u = 0; u < users.length; u++) {
            address user = users[u];
            ContractConfig[] memory contracts = userConfig[user].contracts;
            for (uint256 i = 0; i < contracts.length; i++) {
                if (!contracts[i].enabled) continue;

                address contractAddress = contracts[i].contractAddress;
                uint256 maxBid = contracts[i].maxBid;
                uint192 minBid = cacheManager.getMinBid(contractAddress);

                // Check minBid < maxBid first as it's cheaper than checking cache status
                if (minBid < maxBid) {
                    // Only check cache status if bid amount is acceptable
                    if (
                        !arbWasmCache.codehashIsCached(
                            contractAddress.codehash
                        ) && minBid < contracts[i].lastBid
                    ) {
                        upkeepNeeded = true;
                        totalContracts++;
                    }
                }
            }
        }

        performData = abi.encode(users, totalContracts);
    }

    function performUpkeep(bytes calldata performData) external {
        (address[] memory users, uint256 totalContracts) = abi.decode(
            performData,
            (address[], uint256)
        );

        uint256 totalBids = 0;
        for (uint256 u = 0; u < users.length; u++) {
            address user = users[u];
            ContractConfig[] storage contracts = userConfig[user].contracts;
            for (uint256 i = 0; i < contracts.length; i++) {
                if (!contracts[i].enabled) continue;

                address contractAddress = contracts[i].contractAddress;
                uint256 maxBid = contracts[i].maxBid;
                uint192 minBid = cacheManager.getMinBid(contractAddress);

                // Check minBid < maxBid first as it's cheaper than checking cache status
                if (minBid < maxBid) {
                    // Only check cache status if bid amount is acceptable
                    if (
                        !arbWasmCache.codehashIsCached(
                            contractAddress.codehash
                        ) && minBid < contracts[i].lastBid
                    ) {
                        bool bidSuccess = placeUserBid(
                            user,
                            contractAddress,
                            minBid
                        );
                        if (bidSuccess) {
                            totalBids++;
                            if (totalBids >= totalContracts) {
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    receive() external payable {}

    // function to withdraw balance
    function withdrawBalance() external {
        require(userConfig[msg.sender].balance > 0, "No balance to withdraw");
        payable(msg.sender).transfer(userConfig[msg.sender].balance);
        userConfig[msg.sender].balance = 0;
    }
    // function to fund user's own balance
    function fundBalance() external payable {
        require(msg.value > 0, "Amount must be greater than zero");
        userConfig[msg.sender].balance += msg.value;
    }
}
