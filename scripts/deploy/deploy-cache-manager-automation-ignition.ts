import hre from 'hardhat';
import { createCacheManagerAutomationModule } from '../../ignition/modules/CacheManagerAutomation';
import { getDeploymentConfig } from '../../config/deployment-config';
import { ignition as ignitionConfig } from '../../config/ignition';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const networkName = hre.network.name;
  console.log(`🚀 Deploying CacheManagerAutomation to network: ${networkName}`);

  // Get network-specific configuration
  const config = getDeploymentConfig(networkName);
  const packageJsonPath = path.join(__dirname, '../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version.replace(/\./g, '_');

  console.log(`📋 Using configuration:`);
  console.log(`   Cache Manager Address: ${config.cacheManagerAddress}`);
  console.log(`   ARB WASM Cache Address: ${config.arbWasmCacheAddress}`);
  console.log(`   ARB WASM Address: ${config.arbWasmAddress}`);

  try {
    // Create version-specific module
    const CacheManagerAutomationModule =
      createCacheManagerAutomationModule(version);

    // Deploy with network-specific parameters
    const { cacheManagerAutomation } = await hre.ignition.deploy(
      CacheManagerAutomationModule,
      {
        parameters: {
          [`CacheManagerAutomation_${version}`]: {
            cacheManagerAddress: config.cacheManagerAddress,
            arbWasmCacheAddress: config.arbWasmCacheAddress,
            arbWasmAddress: config.arbWasmAddress,
          },
        },
        config: ignitionConfig,
      }
    );

    const deployedAddress = await cacheManagerAutomation.getAddress();
    console.log(`✅ CacheManagerAutomation deployed to: ${deployedAddress}`);

    // Display deployment summary
    console.log('\n📊 Deployment Summary:');
    console.log(`   Version: ${packageJson.version}`);
    console.log(`   Network: ${networkName}`);
    console.log(`   Contract Address: ${deployedAddress}`);
    console.log(`   Cache Manager: ${config.cacheManagerAddress}`);
    console.log(`   ARB WASM Cache: ${config.arbWasmCacheAddress}`);
    console.log(`   ARB WASM: ${config.arbWasmAddress}`);
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
