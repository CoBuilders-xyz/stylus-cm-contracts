import hre from 'hardhat';
import CacheManagerAutomationModule from '../../ignition/modules/CacheManagerAutomation';
import { getDeploymentConfig } from '../../config/deployment-config';

async function main() {
  const networkName = hre.network.name;
  console.log(`🚀 Deploying CacheManagerAutomation to network: ${networkName}`);

  // Get network-specific configuration
  const config = getDeploymentConfig(networkName);

  console.log(`📋 Using configuration:`);
  console.log(`   Cache Manager Address: ${config.cacheManagerAddress}`);
  console.log(`   ARB WASM Cache Address: ${config.arbWasmCacheAddress}`);

  try {
    // Deploy with network-specific parameters
    const { cacheManagerAutomation } = await hre.ignition.deploy(
      CacheManagerAutomationModule,
      {
        parameters: {
          CacheManagerAutomation: {
            cacheManagerAddress: config.cacheManagerAddress,
            arbWasmCacheAddress: config.arbWasmCacheAddress,
          },
        },
      }
    );

    const deployedAddress = await cacheManagerAutomation.getAddress();
    console.log(`✅ CacheManagerAutomation deployed to: ${deployedAddress}`);

    // Display deployment summary
    console.log('\n📊 Deployment Summary:');
    console.log(`   Network: ${networkName}`);
    console.log(`   Contract Address: ${deployedAddress}`);
    console.log(`   Cache Manager: ${config.cacheManagerAddress}`);
    console.log(`   ARB WASM Cache: ${config.arbWasmCacheAddress}`);
    console.log(`   Max Contracts Per User: ${config.maxContractsPerUser}`);
    console.log(`   Max User Funds: ${config.maxUserFunds}`);
    console.log(`   Verify Contracts: ${config.verify}`);

    console.log('\n🎉 Deployment completed successfully!');
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
