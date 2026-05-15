// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ICacheManager} from '../interfaces/IExternalContracts.sol';

contract MockCacheManager is ICacheManager {
    uint192 public minBid;
    uint64 public _cacheSize;
    uint64 public _queueSize;
    uint64 public _decay;

    function setMinBid(uint192 _b) external {
        minBid = _b;
    }

    function setCache(uint64 c, uint64 q, uint64 d) external {
        _cacheSize = c;
        _queueSize = q;
        _decay = d;
    }

    function getMinBid(address) external view override returns (uint192) {
        return minBid;
    }

    function placeBid(address) external payable override {}

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
