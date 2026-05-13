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

      await expect(
        cma.placeActivations([
          { user: user.address, contractAddress: PROGRAM },
        ])
      ).to.emit(cma, 'ActivationPerformed');
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
