// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

interface ICacheManager {
    function getMinBid(address program) external view returns (uint192);
    function placeBid(address program) external payable;
    function cacheSize() external view returns (uint64);
    function queueSize() external view returns (uint64);
}

contract CacheManagerProxy {
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

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not contract owner");
        _;
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

        ContractConfig[] storage contracts = userConfig[msg.sender].contracts;
        uint256 length = contracts.length;
        bool found = false;

        for (uint256 i = 0; i < length; i++) {
            if (contracts[i].contractAddress == _contract) {
                // If contract already exists, update maxBid and add value to userBalance
                contracts[i].maxBid = _maxBid;
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

        userConfig[msg.sender].balance += msg.value;
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
        uint256 length = contracts.length;
        require(length > 0, "No contracts to remove");

        bool found = false;
        for (uint256 i = 0; i < length; i++) {
            if (contracts[i].contractAddress == _contract) {
                found = true;
                contracts[i] = contracts[length - 1]; // Swap with last element
                contracts.pop(); // Remove last element
                break;
            }
        }

        require(found, "Contract not found");

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
