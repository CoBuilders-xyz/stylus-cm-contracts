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
  const ARB_SYS_ADDRESS = '0x0000000000000000000000000000000000000064';

  async function deployProgramsWithSharedCodehash(): Promise<[string, string]> {
    const ProgramFactory = await hre.ethers.getContractFactory('MockArbWasm');
    const first = (await ProgramFactory.deploy()) as MockArbWasm;
    const second = (await ProgramFactory.deploy()) as MockArbWasm;
    const firstAddress = await first.getAddress();
    const secondAddress = await second.getAddress();

    expect(await hre.ethers.provider.getCode(firstAddress)).to.equal(
      await hre.ethers.provider.getCode(secondAddress)
    );
    return [firstAddress, secondAddress];
  }

  beforeEach(async function () {
    [owner, poisonedUser, validUser] = await hre.ethers.getSigners();

    const MockArbSysFactory = await hre.ethers.getContractFactory('MockArbSys');
    const mockArbSys = await MockArbSysFactory.deploy();
    await hre.network.provider.send('hardhat_setCode', [
      ARB_SYS_ADDRESS,
      await hre.ethers.provider.getCode(await mockArbSys.getAddress()),
    ]);

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
    const [program] = await deployProgramsWithSharedCodehash();
    await cma
      .connect(poisonedUser)
      .insertContract(program, MAX_BID, true, false, 0);
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: program,
      },
      {
        user: poisonedUser.address,
        contractAddress: program,
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
    const [program] = await deployProgramsWithSharedCodehash();
    await cma
      .connect(poisonedUser)
      .insertContract(program, MAX_BID, true, false, 0);
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: program,
      },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
      {
        user: poisonedUser.address,
        contractAddress: program,
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

  it('charges a user only once per block for addresses sharing a codehash', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: firstProgram },
      { user: validUser.address, contractAddress: secondProgram },
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
    expect(bidPlacedEvents[0].args.contractAddress).to.equal(firstProgram);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
  });

  it('blocks the auditor interleaving scenario across two shared codehashes', async function () {
    const [firstP, secondP] = await deployProgramsWithSharedCodehash();
    const QFactory = await hre.ethers.getContractFactory('MockCacheManager');
    const firstQ = (await QFactory.deploy()) as MockCacheManager;
    const secondQ = (await QFactory.deploy()) as MockCacheManager;
    const firstQAddress = await firstQ.getAddress();
    const secondQAddress = await secondQ.getAddress();
    expect(await hre.ethers.provider.getCode(firstQAddress)).to.equal(
      await hre.ethers.provider.getCode(secondQAddress)
    );

    for (const program of [firstP, secondP, firstQAddress, secondQAddress]) {
      await cma
        .connect(validUser)
        .insertContract(program, MAX_BID, true, false, 0);
    }

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: firstP },
      { user: validUser.address, contractAddress: firstQAddress },
      { user: validUser.address, contractAddress: secondP },
      { user: validUser.address, contractAddress: secondQAddress },
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

    expect(bidPlacedEvents.map((event) => event.args.contractAddress)).to.eql([
      firstP,
      firstQAddress,
    ]);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID - (MIN_BID + 1n)
    );
  });

  it('deduplicates paid shared-codehash bids across calls in the same block', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    const CallerFactory = await hre.ethers.getContractFactory(
      'MockPlaceBidsCaller'
    );
    const caller = await CallerFactory.deploy();
    const tx = await caller.placeTwice(
      await cma.getAddress(),
      validUser.address,
      firstProgram,
      secondProgram
    );
    const receipt = await tx.wait();
    const bidPlacedCount = receipt!.logs.filter((log) => {
      try {
        return cma.interface.parseLog(log)?.name === 'BidPlaced';
      } catch {
        return false;
      }
    }).length;

    expect(bidPlacedCount).to.equal(1);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID
    );
  });

  it('deduplicates paid shared-codehash bids across transactions in the same block', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    await hre.network.provider.send('evm_setAutomine', [false]);
    try {
      const firstTx = await cma.connect(owner).placeBids(
        [{ user: validUser.address, contractAddress: firstProgram }],
        { gasLimit: 2_000_000 }
      );
      const secondTx = await cma.connect(poisonedUser).placeBids(
        [{ user: validUser.address, contractAddress: secondProgram }],
        { gasLimit: 2_000_000 }
      );
      await hre.network.provider.send('evm_mine');

      const [firstReceipt, secondReceipt] = await Promise.all([
        firstTx.wait(),
        secondTx.wait(),
      ]);
      expect(firstReceipt!.blockNumber).to.equal(secondReceipt!.blockNumber);

      const bidPlacedCount = [firstReceipt, secondReceipt].reduce(
        (count, receipt) =>
          count +
          receipt!.logs.filter((log) => {
            try {
              return cma.interface.parseLog(log)?.name === 'BidPlaced';
            } catch {
              return false;
            }
          }).length,
        0
      );
      expect(bidPlacedCount).to.equal(1);
      expect(await cma.connect(validUser).getUserBalance()).to.equal(
        FUNDING - MIN_BID
      );
    } finally {
      await hre.network.provider.send('evm_setAutomine', [true]);
    }
  });

  it('keeps shared-codehash authorizations independent across users', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(poisonedUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: firstProgram },
      { user: poisonedUser.address, contractAddress: secondProgram },
    ]);
    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        validUser.address,
        firstProgram,
        MIN_BID,
        MAX_BID,
        FUNDING - MIN_BID
      );
    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        poisonedUser.address,
        secondProgram,
        MIN_BID + 1n,
        MAX_BID,
        FUNDING - MIN_BID - 1n
      );
  });

  it('allows a shared-codehash alias after an earlier bid fails', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);
    await cacheManager.setPlaceBidReverts(firstProgram, true);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: firstProgram },
      { user: validUser.address, contractAddress: secondProgram },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidError')
      .withArgs(
        validUser.address,
        firstProgram,
        MIN_BID,
        'Bid placement failed'
      );
    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        validUser.address,
        secondProgram,
        MIN_BID + 1n,
        MAX_BID,
        FUNDING - MIN_BID - 1n
      );
  });

  it('allows an eligible alias after a shared-codehash request is skipped', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, false, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    const tx = await cma.connect(owner).placeBids([
      { user: validUser.address, contractAddress: firstProgram },
      { user: validUser.address, contractAddress: secondProgram },
    ]);

    await expect(tx)
      .to.emit(cma, 'BidPlaced')
      .withArgs(
        validUser.address,
        secondProgram,
        MIN_BID + 1n,
        MAX_BID,
        FUNDING - MIN_BID - 1n
      );
  });

  it('does not let a free bid suppress a later paid shared-codehash bid', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);
    await cacheManager.setMinBid(0);
    await cacheManager.setCache(100, 0, 0);

    const CallerFactory = await hre.ethers.getContractFactory(
      'MockPlaceBidsCaller'
    );
    const caller = await CallerFactory.deploy();

    await hre.network.provider.send('evm_setAutomine', [false]);
    try {
      const freeTx = await cma.connect(owner).placeBids(
        [{ user: validUser.address, contractAddress: firstProgram }],
        { gasLimit: 2_000_000 }
      );
      const paidTx = await caller.connect(poisonedUser).configureAndPlacePaidBid(
        await cma.getAddress(),
        await cacheManager.getAddress(),
        validUser.address,
        secondProgram,
        MIN_BID,
        { gasLimit: 2_000_000 }
      );
      await hre.network.provider.send('evm_mine');

      const [freeReceipt, paidReceipt] = await Promise.all([
        freeTx.wait(),
        paidTx.wait(),
      ]);
      expect(freeReceipt!.blockNumber).to.equal(paidReceipt!.blockNumber);
      await expect(freeTx)
        .to.emit(cma, 'BidPlaced')
        .withArgs(validUser.address, firstProgram, 0, MAX_BID, FUNDING);
      await expect(paidTx)
        .to.emit(cma, 'BidPlaced')
        .withArgs(
          validUser.address,
          secondProgram,
          MIN_BID,
          MAX_BID,
          FUNDING - MIN_BID
        );
    } finally {
      await hre.network.provider.send('evm_setAutomine', [true]);
    }
  });

  it('allows a user to pay for the same codehash again in a later block', async function () {
    const [firstProgram, secondProgram] =
      await deployProgramsWithSharedCodehash();
    await cma
      .connect(validUser)
      .insertContract(firstProgram, MAX_BID, true, false, 0);
    await cma
      .connect(validUser)
      .insertContract(secondProgram, MAX_BID, true, false, 0);

    const firstTx = await cma
      .connect(owner)
      .placeBids([{ user: validUser.address, contractAddress: firstProgram }]);
    const firstReceipt = await firstTx.wait();
    const secondTx = await cma
      .connect(owner)
      .placeBids([{ user: validUser.address, contractAddress: secondProgram }]);
    const secondReceipt = await secondTx.wait();

    expect(secondReceipt!.blockNumber).to.be.greaterThan(
      firstReceipt!.blockNumber
    );
    expect(await cma.connect(validUser).getUserBalance()).to.equal(
      FUNDING - MIN_BID * 2n
    );
  });

  it('does not let a free bid claim the paid-bid deduplication slot', async function () {
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
    expect(bidPlacedEvents).to.have.length(2);
    expect(await cma.connect(validUser).getUserBalance()).to.equal(FUNDING);
  });

  it('uses the first occurrence index when calculating a duplicated bid', async function () {
    const [program] = await deployProgramsWithSharedCodehash();
    await cma
      .connect(poisonedUser)
      .insertContract(program, MAX_BID, true, false, 0);
    const tx = await cma.connect(owner).placeBids([
      {
        user: poisonedUser.address,
        contractAddress: program,
      },
      { user: validUser.address, contractAddress: VALID_PROGRAM },
      {
        user: poisonedUser.address,
        contractAddress: program,
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
