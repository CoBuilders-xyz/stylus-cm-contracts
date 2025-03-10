// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
}

contract CacheManagerProxy {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Variables
    struct ContractConfig {
        address contractAddress;
        uint256 maxBid;
        bool enabled;
    }
    struct UserConfig {
        ContractConfig[] contracts;
        uint256 balance;
    }
    ICacheManager public immutable cacheManager;
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
    constructor(address _cacheManager) {
        require(_cacheManager != address(0), "Invalid CacheManager address");
        cacheManager = ICacheManager(_cacheManager);
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
    ) internal {
        uint192 minBid = cacheManager.getMinBid(_contract);
        require(_bid >= minBid, "Insufficient bid amount");

        // Get initial gas left
        uint256 initialGas = gasleft();

        // Place the bid
        cacheManager.placeBid{value: _bid}(_contract);

        // Estimate gas used
        uint256 gasUsed = initialGas - gasleft();
        uint256 gasCost = gasUsed * tx.gasprice; // Calculate gas cost

        // Deduct total spent (bid + gas cost) from user balance
        uint256 totalCost = _bid + gasCost;
        require(
            userConfig[_user].balance >= totalCost,
            "Insufficient balance for fees"
        );
        userConfig[_user].balance -= totalCost;

        emit BidPlaced(_user, _contract, _bid);
    }

    receive() external payable {}
}
