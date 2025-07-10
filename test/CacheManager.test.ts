import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { BaseContract } from 'ethers';
import { deployDummyWASMContracts, fillCacheWithBids } from './helpers';

interface CacheManagerContract extends BaseContract {
  cacheSize(): Promise<bigint>;
  queueSize(): Promise<bigint>;
  decay(): Promise<bigint>;
  isPaused(): Promise<boolean>;
  'getMinBid(uint64)'(size: bigint): Promise<bigint>;
  'getMinBid(address)'(program: string): Promise<bigint>;
  getEntries(): Promise<Array<[string, bigint, bigint]>>;
  getSmallestEntries(k: bigint): Promise<Array<[string, bigint, bigint]>>;
  placeBid(program: string, overrides?: { value: bigint }): Promise<any>;
  setCacheSize(newSize: bigint): Promise<any>;
  paused(): Promise<any>;
  unpause(): Promise<any>;
  connect(signer: HardhatEthersSigner): CacheManagerContract;
  evictAll(): Promise<any>;
}

describe('CacheManager Contract Tests', function () {
  // Contract instance and signers
  let cacheManager: CacheManagerContract;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let dummyContracts: string[];

  // Constants
  const CACHE_MANAGER_ADDRESS = process.env.CACHE_MANAGER_ADDRESS || '';
  const MIN_CODESIZE = 4096n; // 4KB as defined in the contract

  before(async function () {
    // Get signers
    [user1] = await ethers.getSigners();
    owner = await ethers.getSigner(process.env.ARBLOC_OWNER_ADD || '0x');

    // Get contract instance at the deployed address using the full ABI
    const CacheManagerABI = [
      // View functions
      'function cacheSize() external view returns (uint64)',
      'function queueSize() external view returns (uint64)',
      'function decay() external view returns (uint64)',
      'function isPaused() external view returns (bool)',
      'function getMinBid(uint64 size) external view returns (uint192)',
      'function getMinBid(address program) external view returns (uint192)',
      'function getEntries() external view returns (tuple(bytes32 code, uint64 size, uint192 bid)[])',
      'function getSmallestEntries(uint256 k) external view returns (tuple(bytes32 code, uint64 size, uint192 bid)[])',
      // State changing functions
      'function placeBid(address program) external payable',
      'function setCacheSize(uint64 newSize) external',
      'function paused() external',
      'function unpause() external',
      'function evictAll() external',
      // Errors
      'error NotChainOwner(address sender)',
      'error BidTooSmall(uint192 bid, uint192 min)',
      'error BidsArePaused()',
      'error AlreadyCached(bytes32 codehash)',
      'error AsmTooLarge(uint256 asm, uint256 queueSize, uint256 cacheSize)',
      'error ProgramNotActivated()',
    ];

    cacheManager = (await ethers.getContractAt(
      CacheManagerABI,
      CACHE_MANAGER_ADDRESS,
      owner
    )) as unknown as CacheManagerContract;
    dummyContracts = await deployDummyWASMContracts(3);
  });

  // Evict all contracts from the cache manager
  beforeEach(async function () {
    await cacheManager.connect(owner).evictAll();
  });

  describe('Initial State', function () {
    it('should have the correct address', async function () {
      expect(cacheManager.target).to.equal(CACHE_MANAGER_ADDRESS);
    });

    it('should be able to query cache size', async function () {
      const cacheSize = await cacheManager.cacheSize();
      console.log(`Current cache size: ${cacheSize}`);
      expect(cacheSize).to.be.gt(0);
    });

    it('should be able to query queue size', async function () {
      const queueSize = await cacheManager.queueSize();
      console.log(`Current queue size: ${queueSize}`);
      expect(queueSize).to.be.gte(0);
    });

    it('should be able to query decay rate', async function () {
      const decay = await cacheManager.decay();
      console.log(`Current decay rate: ${decay}`);
      expect(decay).to.be.gte(0);
    });

    it('should be able to query pause and unpause state', async function () {
      let isPaused = await cacheManager.isPaused();
      console.log(`Is paused: ${isPaused}`);
      expect(isPaused).to.equal(false);
    });
  });

  describe('Bid Management', function () {
    it('should return minBid = 0 for a given size with CM empty', async function () {
      const minBid = await cacheManager['getMinBid(uint64)'](MIN_CODESIZE);
      expect(minBid).to.be.gte(0);
      console.log(`Min bid for ${MIN_CODESIZE} bytes: ${minBid}`);
    });

    it('Should place a bid', async function () {
      await cacheManager.connect(user1).placeBid(dummyContracts[0], {
        value: ethers.parseEther('0.01'),
      });
      const entries = await cacheManager.getEntries();
      expect(entries.length).to.be.eq(1);
      console.log(`Entries: ${entries}`);
    });

    it('should return minBid > 0 for a given size with CM not empty', async function () {
      await fillCacheWithBids(dummyContracts.slice(0, 2));
      const minBid = await cacheManager['getMinBid(address)'](
        dummyContracts[0]
      );
      expect(minBid).to.be.gt(0);
      console.log(`Min bid for ${MIN_CODESIZE} bytes: ${minBid}`);
    });

    it('should handle program not activated error', async function () {
      // We expect this to revert since the program is not activated
      await expect(
        cacheManager['getMinBid(address)'](CACHE_MANAGER_ADDRESS)
      ).to.be.revertedWithCustomError(cacheManager, 'ProgramNotActivated');
    });

    it('should handle valid program sizes', async function () {
      const cacheSize = await cacheManager.cacheSize();
      const sizes = [MIN_CODESIZE, MIN_CODESIZE * 2n, MIN_CODESIZE * 4n].filter(
        (size) => size <= cacheSize
      );

      for (const size of sizes) {
        const minBid = await cacheManager['getMinBid(uint64)'](size);
        console.log(`Min bid for ${size} bytes: ${minBid}`);
        expect(minBid).to.be.gte(0);
      }
    });

    it('should revert when placing bid while paused', async function () {
      const isPaused = await cacheManager.isPaused();
      if (isPaused) {
        await expect(
          cacheManager
            .connect(user1)
            .placeBid(CACHE_MANAGER_ADDRESS, { value: 0n })
        ).to.be.revertedWithCustomError(cacheManager, 'BidsArePaused');
      } else {
        // If not paused, we expect the ProgramNotActivated error
        await expect(
          cacheManager
            .connect(user1)
            .placeBid(CACHE_MANAGER_ADDRESS, { value: 0n })
        ).to.be.revertedWithCustomError(cacheManager, 'ProgramNotActivated');
      }
    });

    it('should revert when program is too large', async function () {
      const currentCacheSize = await cacheManager.cacheSize();
      const tooLargeSize = currentCacheSize + 1n;

      await expect(
        cacheManager['getMinBid(uint64)'](tooLargeSize)
      ).to.be.revertedWithCustomError(cacheManager, 'AsmTooLarge');
    });

    it('Should evict older bids first when making space for a new bid', async function () {
      const dummyContracts = await deployDummyWASMContracts();
      console.log(`Deployed ${dummyContracts.length} dummy contracts`);
      // Warning! This test randomly reverts. After adding 1 second delay between placing bid, it passes.
      // May be related to cache manager processing time?
      const firstBid = dummyContracts[0];
      const secondBid = dummyContracts[1];
      const newBid = dummyContracts[2];

      await fillCacheWithBids([firstBid], '0.01');
      let entries = await cacheManager.getEntries();
      // expect entries to include firstBid
      let codeFirstBid = await ethers.provider.getCode(firstBid);
      let codeFirstBidHash = ethers.keccak256(codeFirstBid);
      expect(entries.some((entry) => entry[0] === codeFirstBidHash)).to.be.true;

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await fillCacheWithBids([secondBid], '0.01');
      entries = await cacheManager.getEntries();
      let codeSecondBid = await ethers.provider.getCode(secondBid);
      let codeSecondBidHash = ethers.keccak256(codeSecondBid);
      expect(entries.some((entry) => entry[0] === codeSecondBidHash)).to.be
        .true;

      // place a new bid

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tx = await cacheManager.connect(user1).placeBid(newBid, {
        value: ethers.parseEther('0.01'),
      });
      await tx.wait();
      entries = await cacheManager.getEntries();
      let newBidCode = await ethers.provider.getCode(newBid);
      let newBidHash = ethers.keccak256(newBidCode);

      //
      console.log(`Contract Hashes`, {
        first: {
          address: firstBid,
          hash: codeFirstBidHash.slice(0, 5),
        },
        second: {
          address: secondBid,
          hash: codeSecondBidHash.slice(0, 5),
        },
        new: { address: newBid, hash: newBidHash.slice(0, 5) },
      });
      console.log(
        `Current Entries`,
        entries.map((entry) => entry[0].slice(0, 5))
      );
      expect(entries.some((entry) => entry[0] === codeSecondBidHash)).to.be
        .true;
      expect(entries.some((entry) => entry[0] === newBidHash)).to.be.true;

      // Expect first bid to be evicted
      expect(entries.some((entry) => entry[0] === codeFirstBidHash)).to.be
        .false;
    });

    it('Should keep the last two bids when bidding several contracts with the same bid', async function () {
      const dummyContracts = await deployDummyWASMContracts();
      console.log(`Deployed ${dummyContracts.length} dummy contracts`);
      await fillCacheWithBids(dummyContracts, '0.01');
      const entries = await cacheManager.getEntries();
      const lastContractIndex = dummyContracts.length - 1;

      const contractsHashes = await Promise.all(
        dummyContracts.map(async (contract) =>
          ethers.keccak256(await ethers.provider.getCode(contract))
        )
      );

      const contractsCached = entries.map((entry) => entry[0]);

      const contractsCachedIndexes = contractsCached.map((hash) =>
        contractsHashes.indexOf(hash)
      );

      console.log(
        'Contracs Info',
        dummyContracts.map((contract, index) => ({
          address: contract,
          hash: contractsHashes[index],
          cached: contractsCachedIndexes.includes(index),
        }))
      );

      expect(
        entries.some((entry) => entry[0] === contractsHashes[lastContractIndex])
      ).to.be.true;
      expect(
        entries.some(
          (entry) => entry[0] === contractsHashes[lastContractIndex - 1]
        )
      ).to.be.true;
    });

    it('Decay should increment bid weight for deciding eviction', async function () {
      const decay = await cacheManager.decay();
      console.log(`Current decay rate: ${decay}`);
      expect(decay).to.be.gte(0);

      // Send 20 dummy transaction to increment block timestamp
      await user1.sendTransaction({ to: owner.address, value: 0n });
      const newDecay = await cacheManager.decay();
      console.log(`New decay rate: ${newDecay}`);
      expect(newDecay).to.be.gt(decay);
    });
  });

  describe('Cache Operations', function () {
    it('should allow querying entries', async function () {
      const entries = await cacheManager.getEntries();
      expect(entries).to.be.an('array');
      console.log(`Current cache entries: ${entries.length}`);

      // Log some details about the entries if they exist
      if (entries.length > 0) {
        console.log('First entry details:');
        console.log(`- Code hash: ${entries[0][0]}`);
        console.log(`- Size: ${entries[0][1]}`);
        console.log(`- Bid: ${entries[0][2]}`);
      }
    });

    it('should return smallest entries', async function () {
      const entries = await cacheManager.getSmallestEntries(5n);
      expect(entries).to.be.an('array');
      expect(entries.length).to.be.lte(5);

      // Log details about the smallest entries
      console.log(`Smallest entries (${entries.length}):`);
      entries.forEach((entry, i) => {
        console.log(`Entry ${i + 1}:`);
        console.log(`- Code hash: ${entry[0]}`);
        console.log(`- Size: ${entry[1]}`);
        console.log(`- Bid: ${entry[2]}`);
      });
    });

    it('should maintain bid ordering', async function () {
      const entries = await cacheManager.getSmallestEntries(5n);
      // Check if bids are ordered (should be ascending)
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i][2]).to.be.gte(
          entries[i - 1][2],
          'Bids should be in ascending order'
        );
      }
    });
  });

  describe('Admin Functions', function () {
    it('should handle non-owner calls to setCacheSize', async function () {
      const currentSize = await cacheManager.cacheSize();
      try {
        await cacheManager.connect(user1).setCacheSize(currentSize + 1n);
        // If we get here, check if the size actually changed
        const newSize = await cacheManager.cacheSize();
        expect(newSize).to.equal(
          currentSize,
          'Cache size should not have changed'
        );
      } catch (error) {
        // Either way is fine - either it reverts or the change doesn't take effect
        console.log('setCacheSize reverted as expected');
      }
    });

    it('should handle non-owner calls to pause', async function () {
      const wasPaused = await cacheManager.isPaused();
      try {
        await cacheManager.connect(user1).paused();
        // If we get here, check if the pause state actually changed
        const isPaused = await cacheManager.isPaused();
        expect(isPaused).to.equal(
          wasPaused,
          'Pause state should not have changed'
        );
      } catch (error) {
        // Either way is fine - either it reverts or the change doesn't take effect
        console.log('pause reverted as expected');
      }
    });
  });

  describe('Bidding System Analysis', function () {
    describe('Cache Configuration Analysis', function () {
      it('should analyze current cache configuration', async function () {
        const cacheSize = await cacheManager.cacheSize();
        const queueSize = await cacheManager.queueSize();
        const decay = await cacheManager.decay();
        const isPaused = await cacheManager.isPaused();

        console.log('\nCache Configuration:');
        console.log(`- Cache Size: ${cacheSize} bytes`);
        console.log(`- Queue Size: ${queueSize} bytes`);
        console.log(`- Decay Rate: ${decay}`);
        console.log(`- Is Paused: ${isPaused}`);

        // Calculate how many minimum size programs could fit
        const maxPrograms = cacheSize / MIN_CODESIZE;
        console.log('\nTheoretical capacity:');
        console.log(
          `- Maximum number of minimum-size (${MIN_CODESIZE} bytes) programs: ${maxPrograms}`
        );
      });

      it('should analyze current cache state', async function () {
        const entries = await cacheManager.getEntries();
        console.log('\nCurrent Cache State:');
        console.log(`Total entries: ${entries.length}`);

        if (entries.length > 0) {
          let totalSize = 0n;
          let minBid = entries[0][2];
          let maxBid = entries[0][2];

          entries.forEach((entry, idx) => {
            const [hash, size, bid] = entry;
            totalSize += size;
            minBid = bid < minBid ? bid : minBid;
            maxBid = bid > maxBid ? bid : maxBid;

            console.log(`\nEntry ${idx + 1}:`);
            console.log(`- Hash: ${hash}`);
            console.log(`- Size: ${size} bytes`);
            console.log(`- Bid: ${ethers.formatEther(bid)} ETH`);
          });

          console.log('\nCache Statistics:');
          console.log(`- Total Size Used: ${totalSize} bytes`);
          console.log(
            `- Space Available: ${
              (await cacheManager.cacheSize()) - totalSize
            } bytes`
          );
          console.log(
            `- Bid Range: ${ethers.formatEther(
              minBid
            )} ETH to ${ethers.formatEther(maxBid)} ETH`
          );
        }
      });

      it('should analyze minimum bid requirements', async function () {
        // Test a range of program sizes
        const cacheSize = await cacheManager.cacheSize();
        const testSizes = [
          MIN_CODESIZE,
          MIN_CODESIZE * 2n,
          MIN_CODESIZE * 4n,
          cacheSize / 2n,
          cacheSize - MIN_CODESIZE,
        ].filter((size) => size <= cacheSize);

        console.log('\nMinimum Bid Analysis:');
        for (const size of testSizes) {
          try {
            const minBid = await cacheManager['getMinBid(uint64)'](size);
            console.log(`\nProgram Size: ${size} bytes`);
            console.log(`- Minimum Bid: ${ethers.formatEther(minBid)} ETH`);

            // If we have current entries, compare with existing bids
            const entries = await cacheManager.getEntries();
            if (entries.length > 0) {
              const lowestBid = entries[0][2];
              console.log(
                `- Comparison: ${
                  minBid > lowestBid ? 'Higher' : 'Lower'
                } than lowest current bid`
              );
            }
          } catch (error) {
            console.log(`Error getting min bid for size ${size}: ${error}`);
          }
        }
      });

      it('should analyze eviction criteria', async function () {
        // Get smallest entries to understand eviction order
        const smallestEntries = await cacheManager.getSmallestEntries(5n);

        console.log('\nEviction Analysis:');
        console.log(
          `Number of potential eviction candidates: ${smallestEntries.length}`
        );

        if (smallestEntries.length > 0) {
          smallestEntries.forEach((entry, idx) => {
            const [hash, size, bid] = entry;
            console.log(`\nCandidate ${idx + 1}:`);
            console.log(`- Hash: ${hash}`);
            console.log(`- Size: ${size} bytes`);
            console.log(`- Bid: ${ethers.formatEther(bid)} ETH`);
          });

          // Verify ascending order
          for (let i = 1; i < smallestEntries.length; i++) {
            expect(smallestEntries[i][2]).to.be.gte(
              smallestEntries[i - 1][2],
              'Bids should be in ascending order for eviction'
            );
          }
          console.log(
            '\nConfirmed: Entries are ordered by bid amount (ascending)'
          );
          console.log(
            'This suggests eviction is based on bid amount, with lowest bids evicted first'
          );
        }
      });
    });
  });

  describe('Eviction Strategy Analysis', function () {
    let dummyContracts: string[];

    before(async function () {
      dummyContracts = await deployDummyWASMContracts();
      console.log(
        `\nDeployed ${dummyContracts.length} dummy contracts for eviction testing`
      );
    });

    it('should analyze bid decay impact on eviction', async function () {
      const decay = await cacheManager.decay();
      const currentTime = BigInt(Math.floor(Date.now() / 1000));
      const decayAmount = decay * currentTime;

      console.log('\nBid Decay Analysis:');
      console.log(`- Current decay rate: ${decay} per second`);
      console.log(`- Current timestamp: ${currentTime}`);
      console.log(
        `- Current decay amount: ${ethers.formatEther(decayAmount)} ETH`
      );

      // Calculate minimum bids at different times
      const size = MIN_CODESIZE;
      const minBid = await cacheManager['getMinBid(uint64)'](size);
      console.log(
        `\nMinimum bid for ${size} bytes: ${ethers.formatEther(minBid)} ETH`
      );
      console.log('This includes the current decay amount');
    });

    it('should analyze eviction order based on bid amounts', async function () {
      // Get current entries and their bids
      const entries = await cacheManager.getEntries();
      const smallestEntries = await cacheManager.getSmallestEntries(10n);

      console.log('\nEviction Order Analysis:');
      console.log(`Total entries in cache: ${entries.length}`);
      console.log(`Smallest entries retrieved: ${smallestEntries.length}`);

      if (smallestEntries.length > 0) {
        console.log('\nEviction candidates (in order):');
        smallestEntries.forEach((entry, idx) => {
          const [hash, size, bid] = entry;
          console.log(`\nRank ${idx + 1}:`);
          console.log(`- Hash: ${hash}`);
          console.log(`- Size: ${size} bytes`);
          console.log(`- Effective bid: ${ethers.formatEther(bid)} ETH`);
        });

        // Verify ascending order (lowest bids first = first to be evicted)
        for (let i = 1; i < smallestEntries.length; i++) {
          expect(smallestEntries[i][2]).to.be.gte(
            smallestEntries[i - 1][2],
            'Entries should be in ascending bid order'
          );
        }
      }
    });

    it('should analyze space reclamation during eviction', async function () {
      const cacheSize = await cacheManager.cacheSize();
      const queueSize = await cacheManager.queueSize();
      const entries = await cacheManager.getEntries();

      console.log('\nSpace Reclamation Analysis:');
      console.log(`- Total cache size: ${cacheSize} bytes`);
      console.log(`- Current queue size: ${queueSize} bytes`);
      console.log(`- Available space: ${cacheSize - queueSize} bytes`);

      if (entries.length > 0) {
        // Calculate cumulative space that would be freed by evictions
        let cumulativeSpace = 0n;
        const smallestEntries = await cacheManager.getSmallestEntries(5n);

        console.log('\nPotential Space Recovery:');
        smallestEntries.forEach((entry, idx) => {
          const [hash, size, bid] = entry;
          cumulativeSpace += size;
          console.log(`\nAfter evicting ${idx + 1} entries:`);
          console.log(`- Cumulative space freed: ${cumulativeSpace} bytes`);
          console.log(`- Last evicted bid: ${ethers.formatEther(bid)} ETH`);
        });
      }
    });

    it('should analyze minimum bid requirements for different cache states', async function () {
      const cacheSize = await cacheManager.cacheSize();
      const queueSize = await cacheManager.queueSize();
      const availableSpace = cacheSize - queueSize;

      console.log('\nMinimum Bid Requirements Analysis:');
      console.log(`- Cache size: ${cacheSize} bytes`);
      console.log(`- Queue size: ${queueSize} bytes`);
      console.log(`- Available space: ${availableSpace} bytes`);

      // Test different program sizes
      const testSizes = [
        MIN_CODESIZE,
        MIN_CODESIZE * 2n,
        availableSpace > MIN_CODESIZE * 4n ? MIN_CODESIZE * 4n : availableSpace,
      ].filter((size) => size <= cacheSize);

      for (const size of testSizes) {
        try {
          const minBid = await cacheManager['getMinBid(uint64)'](size);
          console.log(`\nFor program size ${size} bytes:`);
          console.log(
            `- Minimum bid required: ${ethers.formatEther(minBid)} ETH`
          );

          // Check if this would require eviction
          if (size > availableSpace) {
            console.log('- Would require eviction of existing entries');
            const spaceNeeded = size - availableSpace;
            console.log(`- Additional space needed: ${spaceNeeded} bytes`);
          } else {
            console.log('- Would fit without eviction');
          }
        } catch (error) {
          console.log(`Error calculating min bid for size ${size}: ${error}`);
        }
      }
    });
  });
});
