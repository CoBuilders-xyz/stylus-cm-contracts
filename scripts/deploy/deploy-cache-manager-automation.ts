import { ethers, network } from 'hardhat';
import { getDeploymentConfig } from '../../config/deployment-config';

async function main() {
  console.log(`🚀 Starting deployment on network: ${network.name}`);

  const [deployer] = await ethers.getSigners();
  console.log(`📝 Deploying with account: ${deployer.address}`);

  const balance = await deployer.provider.getBalance(deployer.address);
  console.log(`💰 Account balance: ${ethers.formatEther(balance)} ETH`);

  // Get network-specific configuration
  const config = getDeploymentConfig(network.name);
  console.log(`⚙️  Using config:`, config);

  // Deploy CacheManagerAutomation
  console.log('\n📦 Deploying CacheManagerAutomation...');
  const CacheManagerAutomation = await ethers.getContractFactory(
    'CacheManagerAutomation'
  );

  const cacheManagerAutomation = await CacheManagerAutomation.deploy(
    config.cacheManagerAddress,
    config.arbWasmCacheAddress
  );

  await cacheManagerAutomation.waitForDeployment();
  const cmaAddress = await cacheManagerAutomation.getAddress();

  console.log(`✅ CacheManagerAutomation deployed to: ${cmaAddress}`);

  // Deploy BiddingEscrow
  console.log('\n📦 Deploying BiddingEscrow...');
  const BiddingEscrow = await ethers.getContractFactory('BiddingEscrow');
  const biddingEscrow = await BiddingEscrow.deploy();
  await biddingEscrow.waitForDeployment();
  const escrowAddress = await biddingEscrow.getAddress();

  console.log(`✅ BiddingEscrow deployed to: ${escrowAddress}`);

  // Save deployment addresses
  const deploymentInfo = {
    network: network.name,
    cacheManagerAutomation: cmaAddress,
    biddingEscrow: escrowAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  console.log('\n📊 Deployment Summary:');
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Verify contracts if enabled
  if (config.verify && network.name !== 'hardhat') {
    console.log('\n🔍 Verifying contracts...');
    // Contract verification would go here
    console.log('⚠️  Contract verification not implemented yet');
  }

  console.log('\n🎉 Deployment completed successfully!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
