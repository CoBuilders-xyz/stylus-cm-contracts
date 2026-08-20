/**
 * Deploy the real Arbitrum CacheManager to the devnode.
 * The devnode's built-in CacheManager is simplified and lacks the bidding interface.
 * This deploys the full CacheManager behind an ERC1967 proxy.
 */
import hre from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  const networkName = hre.network.name;
  console.log(`Deploying real CacheManager to ${networkName}...`);

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Load the compiled CacheManager artifact
  const artifactPath = path.resolve(
    __dirname,
    '../../../stylus-cm-backend/src/common/abis/cacheManager/cacheManager.json',
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));

  // Deploy implementation
  const implFactory = new hre.ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer,
  );
  const impl = await implFactory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`Implementation deployed to: ${implAddr}`);

  // Encode initialize calldata
  const initData = implFactory.interface.encodeFunctionData('initialize', [
    536870912n, // ~512 MB cache size
    10000000000n, // decay rate
  ]);

  // Deploy ERC1967 proxy using raw bytecode from @openzeppelin/contracts
  const proxyArtifactPath = require.resolve(
    '@openzeppelin/contracts/build/contracts/ERC1967Proxy.json',
  );
  const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath, 'utf-8'));
  const ProxyFactory = new hre.ethers.ContractFactory(
    proxyArtifact.abi,
    proxyArtifact.bytecode,
    deployer,
  );
  const proxy = await ProxyFactory.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`Proxy (CacheManager) deployed to: ${proxyAddr}`);

  // Register as WASM cache manager via ArbOwner
  const arbOwner = new hre.ethers.Contract(
    '0x0000000000000000000000000000000000000070',
    ['function addWasmCacheManager(address) external'],
    deployer,
  );
  const tx = await arbOwner.addWasmCacheManager(proxyAddr);
  await tx.wait();
  console.log(`Registered as WASM cache manager`);

  // Verify
  const cm = new hre.ethers.Contract(proxyAddr, artifact.abi, deployer);
  const size = await cm.cacheSize();
  const isPaused = await cm.isPaused();
  console.log(`\nVerification:`);
  console.log(`  cacheSize: ${size}`);
  console.log(`  isPaused: ${isPaused}`);

  console.log(`\n✅ CacheManager deployed at: ${proxyAddr}`);
  console.log(`   Use this address for ARB_LOCAL_CACHE_MANAGER_ADDRESS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
