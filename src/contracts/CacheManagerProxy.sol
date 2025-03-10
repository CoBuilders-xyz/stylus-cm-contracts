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
    ICacheManager public immutable cacheManager;
    address public owner;
    mapping(address => ContractConfig[]) public userContracts;
    mapping(address => uint256) private userBalances;
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

        ContractConfig[] storage contracts = userContracts[msg.sender];
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

        userBalances[msg.sender] += msg.value;
        emit ContractAdded(msg.sender, _contract, _maxBid);
    }
    function getUserContracts(
        address _user
    ) external view returns (ContractConfig[] memory) {
        return userContracts[_user];
    }
    //TODO validate if this info needs to be public
    function getUserBalance() external view returns (uint256) {
        return userBalances[msg.sender];
    }
    function removeContract(address _contract) external {
        require(_contract != address(0), "Invalid contract address");

        ContractConfig[] storage contracts = userContracts[msg.sender];
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
        ContractConfig[] storage contracts = userContracts[msg.sender];
        uint256 length = contracts.length;
        require(length > 0, "No contracts to remove");

        // Emit event for each contract before deleting them
        for (uint256 i = 0; i < length; i++) {
            emit ContractRemoved(msg.sender, contracts[i].contractAddress);
        }
        // Clear user's contract list
        delete userContracts[msg.sender];
    }
    function placeUserBid(address _contract) external payable {
        require(_contract != address(0), "Invalid contract address");

        // Check if contract exists in the user's list
        bool exists = false;
        uint256 maxBid;
        ContractConfig[] storage contracts = userContracts[msg.sender];

        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i].contractAddress == _contract) {
                exists = true;
                maxBid = contracts[i].maxBid;
                break;
            }
        }

        // If not found, add the contract with the sent value as maxBid
        if (!exists) {
            maxBid = msg.value; // Use the sent value as maxBid
            userContracts[msg.sender].push(
                ContractConfig({
                    contractAddress: _contract,
                    maxBid: maxBid,
                    enabled: true
                })
            );
            emit ContractAdded(msg.sender, _contract, maxBid);
        }
        // Check the minimum bid required
        uint192 minBid = cacheManager.getMinBid(_contract);
        require(msg.value >= minBid, "Insufficient bid amount");
        // Place the bid
        cacheManager.placeBid{value: msg.value}(_contract);
        emit BidPlaced(msg.sender, _contract, msg.value);
    }

    receive() external payable {}

    //TODO
    // function to withdraw balance
    // function to send balance
}
