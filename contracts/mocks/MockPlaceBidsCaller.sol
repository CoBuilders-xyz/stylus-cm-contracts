// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ICacheManagerAutomation} from '../interfaces/ICacheManagerAutomation.sol';

interface IMockCacheManagerConfig {
    function setMinBid(uint192 minBid) external;
    function setCache(uint64 capacity, uint64 size, uint64 decay) external;
}

contract MockPlaceBidsCaller {
    function placeTwice(
        ICacheManagerAutomation automation,
        address user,
        address firstProgram,
        address secondProgram
    ) external {
        ICacheManagerAutomation.BidRequest[]
            memory requests = new ICacheManagerAutomation.BidRequest[](1);
        requests[0] = ICacheManagerAutomation.BidRequest({
            user: user,
            contractAddress: firstProgram
        });
        automation.placeBids(requests);

        requests[0].contractAddress = secondProgram;
        automation.placeBids(requests);
    }

    function configureAndPlacePaidBid(
        ICacheManagerAutomation automation,
        IMockCacheManagerConfig cacheManager,
        address user,
        address program,
        uint192 minBid
    ) external {
        cacheManager.setMinBid(minBid);
        cacheManager.setCache(100, 100, 0);

        ICacheManagerAutomation.BidRequest[]
            memory requests = new ICacheManagerAutomation.BidRequest[](1);
        requests[0] = ICacheManagerAutomation.BidRequest({
            user: user,
            contractAddress: program
        });
        automation.placeBids(requests);
    }
}
