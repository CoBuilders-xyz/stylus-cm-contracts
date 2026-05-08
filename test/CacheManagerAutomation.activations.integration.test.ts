/**
 * Integration tests for the activation flow against a real nitro-testnode.
 *
 * These specs require:
 *   - A running nitro-testnode at $ARB_LOCAL_RPC with the standard Stylus
 *     precompiles (0x...0070 ArbOwner, 0x...0071 ArbWasm, 0x...0072 ArbWasmCache).
 *   - $ARBLOC_OWNER_ADD / $ARBLOC_OWNER_PK exposing the L2 owner so we can
 *     call `setWasmExpiryDays` and `setWasmKeepaliveDays`.
 *   - $ARB_LOCAL_FUNDED_PK funding the deployer + operator.
 *
 * Forcing a program to expire on a local nitro-testnode requires *real*
 * time travel because the precompile reads the host clock, not block
 * timestamps. The PoC `test/tests.sh` documents the manual sequence:
 *
 *     sudo timedatectl set-ntp false
 *     sudo date -s "+25 hours"
 *     # restart the testnode container so the new host clock is picked up
 *
 * Until that's automated (or replaced by a hardhat-only fork that mocks
 * ArbOwner), the suite below is `describe.skip`. Unskip locally after
 * running the time-travel steps.
 */
import { expect } from 'chai';
import hre from 'hardhat';
import dotenv from 'dotenv';

import {
  CMADeployment,
  deployCMA,
  deployDummyWASMContracts,
  evictAll,
  setCacheSize,
} from './helpers';

dotenv.config();

const ARB_OWNER_ADDRESS = '0x0000000000000000000000000000000000000070';
const ARB_OWNER_ABI = [
  'function setWasmExpiryDays(uint16 _days) external',
  'function setWasmKeepaliveDays(uint16 _days) external',
];
const ARB_WASM_ABI = [
  'function activateProgram(address program) external payable returns (uint16, uint256)',
  'function programTimeLeft(address program) external view returns (uint64)',
];

describe.skip('CacheManagerAutomation — Activations [integration]', function () {
  this.timeout(120_000);

  let cma: CMADeployment;
  let arbWasm: any;

  before(async function () {
    cma = await deployCMA();
    await setCacheSize();
    await evictAll();

    const owner = await hre.ethers.getSigner(
      process.env.ARBLOC_OWNER_ADD || '0x'
    );
    const arbOwner = new hre.ethers.Contract(
      ARB_OWNER_ADDRESS,
      ARB_OWNER_ABI,
      owner
    );
    // Force aggressive expiry so re-activation is exercised.
    await arbOwner.setWasmKeepaliveDays(0);
    await arbOwner.setWasmExpiryDays(1);

    arbWasm = new hre.ethers.Contract(cma.arbWasmAddress, ARB_WASM_ABI, owner);
  });

  it('activates an expired program and refunds the unspent value', async function () {
    const [deployer] = await hre.ethers.getSigners();
    const [program] = await deployDummyWASMContracts(1);
    const programAddr = hre.ethers.getAddress(program);

    // First activation (paid) so the program has a version to expire from.
    await arbWasm.activateProgram(programAddr, {
      value: hre.ethers.parseEther('0.01'),
    });

    // PRE-CONDITION: time-travel the host clock and restart the testnode
    // before reaching this point. Once back, programTimeLeft must read 0.
    const timeLeft = await arbWasm.programTimeLeft(programAddr);
    expect(timeLeft).to.equal(0n);

    const maxActivationCost = hre.ethers.parseEther('0.01');
    const funding = hre.ethers.parseEther('0.05');
    const sentValue = hre.ethers.parseEther('0.005');

    await cma.cacheManagerAutomation
      .connect(deployer)
      .insertContract(
        programAddr,
        hre.ethers.parseEther('0.001'),
        true,
        true,
        maxActivationCost,
        { value: funding }
      );

    const balanceBefore = await cma.cacheManagerAutomation
      .connect(deployer)
      .getUserBalance();

    const tx = await cma.cacheManagerAutomation
      .connect(deployer)
      .placeActivations([
        {
          user: deployer.address,
          contractAddress: programAddr,
          value: sentValue,
        },
      ]);
    await expect(tx).to.emit(cma.cacheManagerAutomation, 'ActivationPerformed');

    const balanceAfter = await cma.cacheManagerAutomation
      .connect(deployer)
      .getUserBalance();
    // Spent something <= sentValue.
    const spent = balanceBefore - balanceAfter;
    expect(spent).to.be.lte(sentValue);
    expect(spent).to.be.gt(0n);

    const timeLeftAfter = await arbWasm.programTimeLeft(programAddr);
    expect(timeLeftAfter).to.be.gt(0n);
  });
});
