import hre from 'hardhat';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.sepolia', override: true });

describe('CacheManagerAutomation Deployment', function () {
  it('Initial Deployment', async function () {
    const cacheManagerAddress = hre.ethers.getAddress(
      process.env.CACHE_MANAGER_ADDRESS || '0x'
    );
    const arbWasmCacheAddress = hre.ethers.getAddress(
      process.env.ARB_WASM_CACHE_ADDRESS || '0x'
    );

    const CacheManagerAutomationFactory = await hre.ethers.getContractFactory(
      'CacheManagerAutomationV2'
    );

    const upgradableProxy = await hre.upgrades.deployProxy(
      CacheManagerAutomationFactory,
      [cacheManagerAddress, arbWasmCacheAddress],
      {
        initializer: 'initialize',
      }
    );

    await upgradableProxy.waitForDeployment();
    console.log('CMA deployed', await upgradableProxy.getAddress());
  });
});
