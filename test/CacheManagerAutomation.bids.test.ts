import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import type {
  BiddingEscrow,
  CacheManagerAutomation,
  CacheManagerAutomationHarness,
  MockArbWasm,
  MockArbWasmCache,
  MockCacheManager,
} from '../build/typechain-types';

describe('CacheManagerAutomation — Bids', function () {
  let cma: CacheManagerAutomation;
  let escrow: BiddingEscrow;
  let cacheManager: MockCacheManager;
  let arbWasmCache: MockArbWasmCache;
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
    arbWasmCache =
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
    escrow = (await hre.ethers.getContractAt(
      'BiddingEscrow',
      await cma.escrow()
    )) as BiddingEscrow;

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

  it('reports the CMA recipient when escrow funds a paid bid', async function () {
    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx)
      .to.emit(escrow, 'WithdrawnForAutomation')
      .withArgs(validUser.address, await cma.getAddress(), MIN_BID);
  });

  it('finds a biddable contract at the end of a multi-contract list', async function () {
    await cma
      .connect(validUser)
      .insertContract(POISONED_PROGRAM, MAX_BID, true, false, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: POISONED_PROGRAM },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        validUser.address,
        POISONED_PROGRAM,
        MIN_BID,
        MAX_BID,
        FUNDING - MIN_BID
      );
  });

  it('skips an unregistered request without calling the cache precompile', async function () {
    const unregisteredProgram = hre.ethers.getAddress(
      '0x000000000000000000000000000000000000cafe'
    );
    await arbWasmCache.setRevertOnCheck(true);

    const tx = await cma.connect(owner).placeBids([
      {
        user: validUser.address,
        contractAddress: unregisteredProgram,
      },
    ]);

    await expect(tx).to.not.emit(cma, 'BidPlaced');
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('skips disabled bidding without calling the cache precompile', async function () {
    await cma
      .connect(validUser)
      .updateContract(VALID_PROGRAM, MAX_BID, false, false, 0);
    await arbWasmCache.setRevertOnCheck(true);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx).to.not.emit(cma, 'BidPlaced');
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('consults the cache precompile for registered enabled bidding', async function () {
    await arbWasmCache.setRevertOnCheck(true);

    await expect(
      cma.connect(owner).placeBids([
        { user: validUser.address, contractAddress: VALID_PROGRAM },
      ])
    ).to.be.revertedWithCustomError(arbWasmCache, 'CacheCheckCalled');
  });

  it('skips a registered contract that is already cached', async function () {
    // VALID_PROGRAM is a non-existent dummy address, so EXTCODEHASH returns 0.
    await arbWasmCache.setCached(hre.ethers.ZeroHash, true);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx).to.not.emit(cma, 'BidPlaced');
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('preserves zero-value bids when the user has no balance', async function () {
    await cacheManager.setMinBid(0);
    await cacheManager.setCache(100, 0, 0);
    await cma.connect(validUser).withdrawBalance();

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: VALID_PROGRAM },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(validUser.address, VALID_PROGRAM, 0, MAX_BID, 0);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(0);
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
    // Stay above the precompile range so every candidate is an empty account.
    for (let candidate = 0x10000; collidingPrograms.length < 3; candidate++) {
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

  it('saturates an oversized calculated bid instead of truncating it', async function () {
    const maxUint192 = (1n << 192n) - 1n;
    const HarnessFactory = await hre.ethers.getContractFactory(
      'CacheManagerAutomationHarness'
    );
    const harness = (await HarnessFactory.deploy(
      await cacheManager.getAddress(),
      await cma.arbWasmCache(),
      await cma.arbWasm()
    )) as CacheManagerAutomationHarness;

    expect(
      await harness.calculateBidAmount(
        hre.ethers.MaxUint256,
        1,
        maxUint192
      )
    ).to.equal(maxUint192);
  });
});
