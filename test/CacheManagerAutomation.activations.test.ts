import { expect } from 'chai';
import hre from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import type {
  CacheManagerAutomation,
  MockArbWasm,
  MockArbWasmCache,
  MockCacheManager,
} from '../build/typechain-types';

describe('CacheManagerAutomation — Activations', function () {
  let cma: CacheManagerAutomation;
  let arbWasm: MockArbWasm;
  let arbWasmCache: MockArbWasmCache;
  let cacheManager: MockCacheManager;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  // A program address. Using a non-precompile dummy address; the mock doesn't
  // care about the address being a real Stylus program.
  const PROGRAM = hre.ethers.getAddress(
    '0x000000000000000000000000000000000000beef'
  );
  const PROGRAM_2 = hre.ethers.getAddress(
    '0x000000000000000000000000000000000000bee2'
  );

  const MAX_BID = hre.ethers.parseEther('0.001');
  const MAX_ACTIVATION_COST = hre.ethers.parseEther('0.01');
  const FUNDING = hre.ethers.parseEther('0.05');

  beforeEach(async function () {
    [owner, user] = await hre.ethers.getSigners();

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
    arbWasm = (await MockArbWasmFactory.deploy()) as MockArbWasm;

    const CMAFactory = await hre.ethers.getContractFactory(
      'CacheManagerAutomation'
    );
    cma = (await CMAFactory.deploy(
      await cacheManager.getAddress(),
      await arbWasmCache.getAddress(),
      await arbWasm.getAddress()
    )) as CacheManagerAutomation;
  });

  async function insertWithActivation(
    program: string = PROGRAM,
    autoActivate: boolean = true,
    maxActivationCost: bigint = MAX_ACTIVATION_COST,
    funding: bigint = FUNDING,
    signer: HardhatEthersSigner = user
  ) {
    return cma
      .connect(signer)
      .insertContract(program, MAX_BID, true, autoActivate, maxActivationCost, {
        value: funding,
      });
  }

  describe('insertContract / updateContract', function () {
    it('allows inserting a contract without funding', async function () {
      await cma
        .connect(user)
        .insertContract(PROGRAM, MAX_BID, true, false, 0, { value: 0 });

      expect(await cma.connect(user).getUserBalance()).to.equal(0);
      expect(await cma.connect(user).getUserContracts()).to.have.length(1);
    });

    it('rejects insertContract funding below minFundAmount without changing state', async function () {
      const minFundAmount = 100n;
      await cma.setMinFundAmount(minFundAmount);

      await expect(
        cma
          .connect(user)
          .insertContract(PROGRAM, MAX_BID, true, false, 0, {
            value: minFundAmount - 1n,
          })
      ).to.be.revertedWithCustomError(cma, 'InvalidFundAmount');

      expect(await cma.connect(user).getUserBalance()).to.equal(0);
      expect(await cma.connect(user).getUserContracts()).to.have.length(0);
    });

    it('rejects insertContract funding that exceeds maxUserFunds', async function () {
      const maxUserFunds = 1_000n;
      await cma.setMaxUserFunds(maxUserFunds);
      await cma.connect(user).fundBalance({ value: 900n });

      await expect(
        cma
          .connect(user)
          .insertContract(PROGRAM, MAX_BID, true, false, 0, { value: 101n })
      ).to.be.revertedWithCustomError(cma, 'ExceedsMaxUserFunds');

      expect(await cma.connect(user).getUserBalance()).to.equal(900n);
      expect(await cma.connect(user).getUserContracts()).to.have.length(0);
    });

    it('allows insertContract funding up to exactly maxUserFunds', async function () {
      const maxUserFunds = 1_000n;
      await cma.setMinFundAmount(100n);
      await cma.setMaxUserFunds(maxUserFunds);
      await cma.connect(user).fundBalance({ value: 900n });

      await cma
        .connect(user)
        .insertContract(PROGRAM, MAX_BID, true, false, 0, { value: 100n });

      expect(await cma.connect(user).getUserBalance()).to.equal(maxUserFunds);
      expect(await cma.connect(user).getUserContracts()).to.have.length(1);
    });

    it('preserves fundBalance minimum and cumulative maximum validation', async function () {
      await cma.setMinFundAmount(100n);
      await cma.setMaxUserFunds(1_000n);

      await cma.connect(user).fundBalance({ value: 100n });
      await expect(
        cma.connect(user).fundBalance({ value: 99n })
      ).to.be.revertedWithCustomError(cma, 'InvalidFundAmount');
      await expect(
        cma.connect(user).fundBalance({ value: 901n })
      ).to.be.revertedWithCustomError(cma, 'ExceedsMaxUserFunds');

      expect(await cma.connect(user).getUserBalance()).to.equal(100n);
    });

    it('reverts when autoActivate=true with maxActivationCost=0', async function () {
      await expect(
        cma
          .connect(user)
          .insertContract(PROGRAM, MAX_BID, true, true, 0, { value: FUNDING })
      ).to.be.revertedWithCustomError(cma, 'InvalidActivationCost');
    });

    it('emits ContractAutoActivateUpdated and ContractMaxActivationCostUpdated on insert', async function () {
      await expect(insertWithActivation())
        .to.emit(cma, 'ContractAutoActivateUpdated')
        .withArgs(user.address, PROGRAM, true)
        .and.to.emit(cma, 'ContractMaxActivationCostUpdated')
        .withArgs(user.address, PROGRAM, MAX_ACTIVATION_COST);
    });

    it('updateContract toggles autoActivate and maxActivationCost', async function () {
      await insertWithActivation();
      const newCost = hre.ethers.parseEther('0.02');
      await expect(
        cma.connect(user).updateContract(PROGRAM, MAX_BID, true, true, newCost)
      )
        .to.emit(cma, 'ContractAutoActivateUpdated')
        .withArgs(user.address, PROGRAM, true)
        .and.to.emit(cma, 'ContractMaxActivationCostUpdated')
        .withArgs(user.address, PROGRAM, newCost);

      const contracts = await cma.connect(user).getUserContracts();
      const cfg = contracts.find((c) => c.contractAddress === PROGRAM)!;
      expect(cfg.autoActivate).to.equal(true);
      expect(cfg.maxActivationCost).to.equal(newCost);
    });

    it('updateContract rejects a max bid below minMaxBidAmount without changing state', async function () {
      await insertWithActivation();
      const minMaxBidAmount = MAX_BID + 100n;
      await cma.setMinMaxBidAmount(minMaxBidAmount);

      await expect(
        cma
          .connect(user)
          .updateContract(PROGRAM, minMaxBidAmount - 1n, false, false, 0)
      ).to.be.revertedWithCustomError(cma, 'InvalidBid');

      const [cfg] = await cma.connect(user).getUserContracts();
      expect(cfg.maxBid).to.equal(MAX_BID);
      expect(cfg.biddingEnabled).to.equal(true);
      expect(cfg.autoActivate).to.equal(true);
      expect(cfg.maxActivationCost).to.equal(MAX_ACTIVATION_COST);
    });

    it('updateContract accepts a max bid equal to minMaxBidAmount', async function () {
      await insertWithActivation();
      const minMaxBidAmount = MAX_BID + 100n;
      await cma.setMinMaxBidAmount(minMaxBidAmount);

      await cma
        .connect(user)
        .updateContract(PROGRAM, minMaxBidAmount, true, false, 0);

      const [cfg] = await cma.connect(user).getUserContracts();
      expect(cfg.maxBid).to.equal(minMaxBidAmount);
    });

    it('updateContract with autoActivate=true and maxActivationCost=0 reverts', async function () {
      await insertWithActivation();
      await expect(
        cma.connect(user).updateContract(PROGRAM, MAX_BID, true, true, 0)
      ).to.be.revertedWithCustomError(cma, 'InvalidActivationCost');
    });

    it('updateContract reverts ContractNotFound when contract is unknown', async function () {
      await expect(
        cma
          .connect(user)
          .updateContract(PROGRAM, MAX_BID, true, false, 0)
      ).to.be.revertedWithCustomError(cma, 'ContractNotFound');
    });

    it('insertContract reverts when maxActivationCost exceeds maxUserFunds', async function () {
      const aboveCap = hre.ethers.parseEther('2'); // default maxUserFunds = 1 ether
      await expect(
        cma
          .connect(user)
          .insertContract(PROGRAM, MAX_BID, true, true, aboveCap, {
            value: FUNDING,
          })
      ).to.be.revertedWithCustomError(cma, 'InvalidActivationCost');
    });

    it('updateContract reverts when maxActivationCost exceeds maxUserFunds', async function () {
      await insertWithActivation();
      const aboveCap = hre.ethers.parseEther('2');
      await expect(
        cma.connect(user).updateContract(PROGRAM, MAX_BID, true, true, aboveCap)
      ).to.be.revertedWithCustomError(cma, 'InvalidActivationCost');
    });
  });

  describe('owner configuration bounds', function () {
    it('keeps minFundAmount at or below maxUserFunds', async function () {
      const maxUserFunds = 1_000n;
      await cma.setMaxUserFunds(maxUserFunds);

      await expect(
        cma.setMinFundAmount(maxUserFunds + 1n)
      ).to.be.revertedWith('Min fund amount must be within user funds limit');
      expect(await cma.minFundAmount()).to.equal(1n);

      await cma.setMinFundAmount(maxUserFunds);
      expect(await cma.minFundAmount()).to.equal(maxUserFunds);
    });

    it('keeps maxUserFunds at or above minFundAmount', async function () {
      const minFundAmount = 1_000n;
      await cma.setMinFundAmount(minFundAmount);

      await expect(
        cma.setMaxUserFunds(minFundAmount - 1n)
      ).to.be.revertedWith(
        'Max user funds must cover minimum fund amount'
      );
      expect(await cma.maxUserFunds()).to.equal(hre.ethers.parseEther('1'));

      await cma.setMaxUserFunds(minFundAmount);
      expect(await cma.maxUserFunds()).to.equal(minFundAmount);
    });

    it('restricts cacheThreshold to the inclusive 1-100 range', async function () {
      await expect(cma.setCacheThreshold(0)).to.be.revertedWith(
        'Cache threshold must be between 1 and 100'
      );
      await expect(cma.setCacheThreshold(101)).to.be.revertedWith(
        'Cache threshold must be between 1 and 100'
      );
      expect(await cma.cacheThreshold()).to.equal(98n);

      await cma.setCacheThreshold(1);
      await cma.setCacheThreshold(100);
      expect(await cma.cacheThreshold()).to.equal(100n);
    });

    it('caps maxUsersPerPage at 100', async function () {
      await expect(cma.setMaxUsersPerPage(0)).to.be.revertedWith(
        'Max users per page out of range'
      );
      await expect(cma.setMaxUsersPerPage(101)).to.be.revertedWith(
        'Max users per page out of range'
      );
      expect(await cma.maxUsersPerPage()).to.equal(100n);

      await cma.setMaxUsersPerPage(100);
      expect(await cma.maxUsersPerPage()).to.equal(100n);
    });

    it('caps maxBidsPerIteration at the tested 50-request limit', async function () {
      await expect(cma.setMaxBidsPerIteration(0)).to.be.revertedWith(
        'Max bids per iteration out of range'
      );
      await expect(cma.setMaxBidsPerIteration(51)).to.be.revertedWith(
        'Max bids per iteration out of range'
      );
      expect(await cma.maxBidsPerIteration()).to.equal(50n);

      await cma.setMaxBidsPerIteration(50);
      expect(await cma.maxBidsPerIteration()).to.equal(50n);
    });

    it('caps horizonSeconds at 365 days', async function () {
      const maxHorizon = 365n * 24n * 60n * 60n;
      await expect(cma.setHorizonSeconds(0)).to.be.revertedWith(
        'Horizon seconds out of range'
      );
      await expect(
        cma.setHorizonSeconds(maxHorizon + 1n)
      ).to.be.revertedWith('Horizon seconds out of range');
      expect(await cma.horizonSeconds()).to.equal(30n * 24n * 60n * 60n);

      await cma.setHorizonSeconds(maxHorizon);
      expect(await cma.horizonSeconds()).to.equal(maxHorizon);
    });

    it('caps bidIncrement at 1 ether', async function () {
      const maxIncrement = hre.ethers.parseEther('1');
      await expect(cma.setBidIncrement(0)).to.be.revertedWith(
        'Bid increment out of range'
      );
      await expect(cma.setBidIncrement(maxIncrement + 1n)).to.be.revertedWith(
        'Bid increment out of range'
      );
      expect(await cma.bidIncrement()).to.equal(1n);

      await cma.setBidIncrement(maxIncrement);
      expect(await cma.bidIncrement()).to.equal(maxIncrement);
    });
  });

  describe('receive()', function () {
    it('rejects ETH from untrusted senders', async function () {
      await expect(
        user.sendTransaction({
          to: await cma.getAddress(),
          value: hre.ethers.parseEther('0.01'),
        })
      ).to.be.revertedWithCustomError(cma, 'UnauthorizedSender');
    });
  });

  describe('placeActivations — guards', function () {
    it('reverts when batch exceeds maxActivationsPerIteration', async function () {
      await cma.setMaxActivationsPerIteration(2);
      const reqs = [
        { user: user.address, contractAddress: PROGRAM },
        { user: user.address, contractAddress: PROGRAM },
        { user: user.address, contractAddress: PROGRAM },
      ];
      await expect(cma.placeActivations(reqs)).to.be.revertedWithCustomError(
        cma,
        'TooManyActivations'
      );
    });

    it('skips when contract is not registered for the user', async function () {
      await arbWasm.setDefaultTimeLeft(0);
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
      await expect(tx).to.not.emit(cma, 'ActivationError');
    });

    it('skips when autoActivate is false', async function () {
      await cma
        .connect(user)
        .insertContract(PROGRAM, MAX_BID, true, false, 0, { value: FUNDING });
      await arbWasm.setDefaultTimeLeft(0);
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
    });

    it('allows activation when automated bidding is disabled', async function () {
      await cma
        .connect(user)
        .insertContract(
          PROGRAM,
          MAX_BID,
          false,
          true,
          MAX_ACTIVATION_COST,
          { value: FUNDING }
        );
      await arbWasm.setDefaultTimeLeft(0);
      await arbWasm.setVersion(7);

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      await expect(tx).to.emit(cma, 'ActivationPerformed');
      await expect(tx).to.emit(arbWasm, 'Activated');
      expect(await cma.connect(user).getUserBalance()).to.equal(
        FUNDING - MAX_ACTIVATION_COST
      );
    });

    it('skips when programTimeLeft != 0 (not expired)', async function () {
      await insertWithActivation();
      await arbWasm.setTimeLeftFor(PROGRAM, 12345);
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
    });

    it('skips when programTimeLeft reverts (program never activated)', async function () {
      await insertWithActivation();
      await arbWasm.setTimeLeftReverts(true);
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
      await expect(tx).to.not.emit(cma, 'ActivationError');
    });

    it('skips when programTimeLeft reverts with unknown selector', async function () {
      await insertWithActivation();
      await arbWasm.setTimeLeftRevertWithSelector('0xdeadbeef');
      await arbWasm.setDataFee(hre.ethers.parseEther('0.003'));
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
      await expect(tx).to.not.emit(cma, 'ActivationError');
    });

    it('proceeds when programTimeLeft reverts with ProgramExpired (new ArbWasm)', async function () {
      await insertWithActivation();
      await arbWasm.setTimeLeftRevertWithExpired(90000n);
      await arbWasm.setVersion(7);
      await arbWasm.setDataFee(hre.ethers.parseEther('0.003'));

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      await expect(tx).to.emit(cma, 'ActivationPerformed');
      await expect(tx).to.emit(arbWasm, 'Activated');
      expect(await cma.connect(user).getUserBalance()).to.equal(
        FUNDING - MAX_ACTIVATION_COST
      );
    });

    it('proceeds when programTimeLeft reverts with ProgramNeedsUpgrade', async function () {
      await insertWithActivation();
      await arbWasm.setTimeLeftRevertWithNeedsUpgrade(6, 7);
      await arbWasm.setVersion(7);
      await arbWasm.setDataFee(hre.ethers.parseEther('0.003'));

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      await expect(tx).to.emit(cma, 'ActivationPerformed');
      await expect(tx).to.emit(arbWasm, 'Activated');
      expect(await cma.connect(user).getUserBalance()).to.equal(
        FUNDING - MAX_ACTIVATION_COST
      );
    });

    it('skips when maxActivationCost > user escrow balance', async function () {
      // Cap = MAX_ACTIVATION_COST but escrow only has 1 wei.
      await insertWithActivation(PROGRAM, true, MAX_ACTIVATION_COST, 1n);
      await arbWasm.setDefaultTimeLeft(0);
      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);
      await expect(tx).to.not.emit(cma, 'ActivationPerformed');
    });
  });

  describe('placeActivations — execution', function () {
    const DATA_FEE = hre.ethers.parseEther('0.003');

    beforeEach(async function () {
      await arbWasm.setDefaultTimeLeft(0);
      await arbWasm.setVersion(7);
      await arbWasm.setDataFee(DATA_FEE);
    });

    it('spends maxActivationCost when precompile keeps the excess', async function () {
      await insertWithActivation();

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      // Mock keeps the entire value (refundExcess = false): spent = cap,
      // refund = 0, user balance drops by the cap.
      await expect(tx)
        .to.emit(cma, 'ActivationPerformed')
        .withArgs(
          user.address,
          PROGRAM,
          7,
          DATA_FEE,
          MAX_ACTIVATION_COST,
          0,
          FUNDING - MAX_ACTIVATION_COST
        );

      expect(await cma.connect(user).getUserBalance()).to.equal(
        FUNDING - MAX_ACTIVATION_COST
      );
    });

    it('refunds excess back to user escrow when precompile auto-refunds', async function () {
      await insertWithActivation();
      await arbWasm.setRefundExcess(true);

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      const expectedRefund = MAX_ACTIVATION_COST - DATA_FEE;
      await expect(tx)
        .to.emit(cma, 'ActivationPerformed')
        .withArgs(
          user.address,
          PROGRAM,
          7,
          DATA_FEE,
          DATA_FEE,
          expectedRefund,
          FUNDING - DATA_FEE
        );

      expect(await cma.connect(user).getUserBalance()).to.equal(
        FUNDING - DATA_FEE
      );
    });

    it('refunds full value when activateProgram reverts', async function () {
      await insertWithActivation();
      await arbWasm.setShouldRevert(true);

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
      ]);

      await expect(tx)
        .to.emit(cma, 'ActivationError')
        .withArgs(
          user.address,
          PROGRAM,
          MAX_ACTIVATION_COST,
          'Activation failed'
        );

      expect(await cma.connect(user).getUserBalance()).to.equal(FUNDING);
    });

    it('processes a batch and skips invalid entries without aborting', async function () {
      await insertWithActivation(PROGRAM);
      await arbWasm.setRefundExcess(true);

      // Second program: registered but not auto-activate.
      await cma
        .connect(user)
        .insertContract(PROGRAM_2, MAX_BID, true, false, 0, { value: 0 });

      const tx = await cma.placeActivations([
        { user: user.address, contractAddress: PROGRAM },
        { user: user.address, contractAddress: PROGRAM_2 },
      ]);

      const receipt = await tx.wait();
      const performed = receipt!.logs.filter((l) => {
        try {
          const parsed = cma.interface.parseLog({
            topics: l.topics as string[],
            data: l.data,
          });
          return parsed?.name === 'ActivationPerformed';
        } catch {
          return false;
        }
      });
      expect(performed).to.have.lengthOf(1);
    });
  });
});
