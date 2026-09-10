// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ICacheManager} from '../interfaces/IExternalContracts.sol';

contract MockCacheManager is ICacheManager {
    error MinBidUnavailable(address program);
    error BidUnavailable(address program);

    uint192 public minBid;
    uint64 public _cacheSize;
    uint64 public _queueSize;
    uint64 public _decay;
    mapping(address => bool) public minBidReverts;
    mapping(address => bool) public placeBidReverts;

    function setMinBid(uint192 _b) external {
        minBid = _b;
    }

    function setCache(uint64 c, uint64 q, uint64 d) external {
        _cacheSize = c;
        _queueSize = q;
        _decay = d;
    }

    function setMinBidReverts(address program, bool shouldRevert) external {
        minBidReverts[program] = shouldRevert;
    }

    function setPlaceBidReverts(address program, bool shouldRevert) external {
        placeBidReverts[program] = shouldRevert;
    }

    function getMinBid(address program) external view override returns (uint192) {
        if (minBidReverts[program]) revert MinBidUnavailable(program);
        return minBid;
    }

    function placeBid(address program) external payable override {
        if (placeBidReverts[program]) revert BidUnavailable(program);
    }

    function cacheSize() external view override returns (uint64) {
        return _cacheSize;
    }

    function queueSize() external view override returns (uint64) {
        return _queueSize;
    }

    function decay() external view override returns (uint64) {
        return _decay;
    }
}
