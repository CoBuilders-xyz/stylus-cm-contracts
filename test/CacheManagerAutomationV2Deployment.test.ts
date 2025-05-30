import { expect } from 'chai';
import hre from 'hardhat';
import { CMADeployment, deployCMASepolia } from './helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('CacheManagerAutomation Deployment', function () {
  it('Initial Deployment', async function () {
    // no timeout
    this.timeout(0);
    await deployCMASepolia();
  });
});
