import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import type {
  CacheManagerAutomation,
  MockArbWasm,
  MockArbWasmCache,
  MockCacheManager,
} from '../build/typechain-types';

describe('CacheManagerAutomation — Bids', function () {
  let cma: CacheManagerAutomation;
  let cacheManager: MockCacheManager;
  let owner: HardhatEthersSigner;
  let poisonedUser: HardhatEthersSigner;
  let validUser: HardhatEthersSigner;

  const POISONED_PROGRAM = hre.ethers.getAddress(
    '0x000000000000000000000000000000000000bad0'
  );
  const VALID_PROGRAM = hre.ethers.getAddress(
    '0x000000000000000000000000000000000000b1d0'
  );
  const MAX_BID = 1_000n;
  const FUNDING = 1_000n;
  const MIN_BID = 100n;

  beforeEach(async function () {
    [owner, poisonedUser, validUser] = await hre.ethers.getSigners();

    const MockCacheManagerFactory = await hre.ethers.getContractFactory(
      'MockCacheManager'
    );
    cacheManager = (await MockCacheManagerFactory.deploy()) as MockCacheManager;

    const MockArbWasmCacheFactory = await hre.ethers.getContractFactory(
      'MockArbWasmCache'
    );
    const arbWasmCache =
      (await MockArbWasmCacheFactory.deploy()) as MockArbWasmCache;

    const MockArbWasmFactory = await hre.ethers.getContractFactory(
      'MockArbWasm'
    );
    const arbWasm = (await MockArbWasmFactory.deploy()) as MockArbWasm;

    const CMAFactory = await hre.ethers.getContractFactory(
      'CacheManagerAutomation'
    );
    cma = (await CMAFactory.deploy(
      await cacheManager.getAddress(),
      await arbWasmCache.getAddress(),
      await arbWasm.getAddress()
    )) as CacheManagerAutomation;

    await cacheManager.setMinBid(MIN_BID);
    await cacheManager.setCache(100, 100, 0);

    await cma
      .connect(poisonedUser)
      .insertContract(POISONED_PROGRAM, MAX_BID, true, false, 0, {
        value: FUNDING,
      });
    await cma
      .connect(validUser)
      .insertContract(VALID_PROGRAM, MAX_BID, true, false, 0, {
        value: FUNDING,
      });
  });

  it('skips a reverting getMinBid entry and continues the batch', async function () {
    await cacheManager.setMinBidReverts(POISONED_PROGRAM, true);

    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        validUser.address,
        VALID_PROGRAM,
        MIN_BID + 1n,
        MAX_BID,
        FUNDING - MIN_BID - 1n
      );

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(1);
    expect(bidPlacedEvents[0].args.user).to.equal(validUser.address);
    expect(bidPlacedEvents[0].args.contractAddress).to.equal(VALID_PROGRAM);

    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(FUNDING);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID - 1n
    );
  });

  it('preserves zero-value bids when the cache has free capacity', async function () {
    await cacheManager.setMinBid(0);
    await cacheManager.setCache(100, 0, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(validUser.address, VALID_PROGRAM, 0, MAX_BID, FUNDING);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('processes a duplicated user-contract pair only once', async function () {
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(1);
    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
  });

  it('skips an interleaved duplicate without skipping unique requests', async function () {
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(2);
    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID - 1n
    );
  });

  it('allows different users to bid for the same registered contract', async function () {
    await cma
      .connect(validUser)
      .insertContract(POISONED_PROGRAM, MAX_BID, true, false, 0, { value: 0 });

    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
      {
        user: validUser.address,
        contractAddress: POISONED_PROGRAM,
      },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(2);
    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID - 1n
    );
  });

  it('processes a duplicated free bid only once', async function () {
    await cacheManager.setMinBid(0);
    await cacheManager.setCache(100, 0, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(1);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('uses the first occurrence index when calculating a duplicated bid', async function () {
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
      {
        user: poisonedUser.address,
        contractAddress: POISONED_PROGRAM,
      },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(2);
    const duplicatedPairEvents = bidPlacedEvents.filter(
      (event) => event.args.user === poisonedUser.address
    );
    expect(duplicatedPairEvents).to.have.length(1);
    expect(duplicatedPairEvents[0].args.bidAmount).to.equal(MIN_BID);
    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
  });

  it('deduplicates correctly across hash collisions and table wrap-around', async function () {
    const coder = hre.ethers.AbiCoder.defaultAbiCoder();
    const collidingPrograms: string[] = [];

    // Four requests allocate an eight-slot table. Bucket 7 forces probes to
    // wrap through slots 0 and 1 for the second and third unique programs.
    for (let candidate = 1; collidingPrograms.length < 3; candidate++) {
      const program = hre.ethers.getAddress(
        `0x${candidate.toString(16).padStart(40, '0')}`
      );
      const key = hre.ethers.keccak256(
        coder.encode(['address', 'address'], [poisonedUser.address, program])
      );
      if ((BigInt(key) & 7n) === 7n) collidingPrograms.push(program);
    }

    for (const program of collidingPrograms) {
      await cma
        .connect(poisonedUser)
        .insertContract(program, MAX_BID, true, false, 0, { value: 0 });
    }

    const tx = await cma.connect(owner).placeBids([
      ...collidingPrograms.map((contractAddress) => ({
        user: poisonedUser.address,
        contractAddress,
      })),
      {
        user: poisonedUser.address,
        contractAddress: collidingPrograms[2],
      },
    ]);

    const receipt = await tx.wait();
    const bidPlacedEvents = receipt!.logs.flatMap((log) => {
      try {
        const parsed = cma.interface.parseLog(log);
        return parsed?.name === 'BidPlaced' ? [parsed] : [];
      } catch {
        return [];
      }
    });
    expect(bidPlacedEvents).to.have.length(3);
    expect(await cma.connect(poisonedUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID - (MIN_BID + 1n) - (MIN_BID + 2n)
    );
  });
});
