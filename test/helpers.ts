import { exec } from 'child_process';
import util from 'util';
import hre from 'hardhat';
import { Signer, Provider, Contract } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();
const execPromise = util.promisify(exec);

import cacheManagerABIJson from '../src/abis/cacheManagerABI.json';
import arbWasmCacheABIJson from '../src/abis/arbWasmCacheABI.json';
import type { CacheManagerAutomationV2 } from '../typechain-types';
import { ICacheManager__factory } from '../typechain-types/factories/src/contracts/interfaces/IExternalContracts.sol';

export interface CMADeployment {
  cacheManagerAutomation: CacheManagerAutomationV2;
  cacheManager: Contract;
  cacheManagerAddress: string;
  arbWasmCacheAddress: string;
  owner: Signer;
  provider: Provider;
}

/**
 * Deploys a Cache Manager Automation contract and returns its deployment details.
 *
 * @returns {Promise<CMADeployment>} An object containing the deployed Cache Manager Automation instance,
 * the cache manager address, and the owner signer.
 */
export async function deployCMA(): Promise<CMADeployment> {
  const [owner] = await hre.ethers.getSigners();
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const arbWasmCacheAddress = hre.ethers.getAddress(
    process.env.ARB_WASM_CACHE_ADDRESS || '0x'
  );

  const l2Owner = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
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

  const cacheManager = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    l2Owner
  );

  return {
    cacheManagerAutomation: upgradableProxy.connect(owner),
    cacheManager,
    cacheManagerAddress,
    arbWasmCacheAddress,
    owner,
    provider: owner.provider,
  };
}

/**
 * Deploys dummy WASM contracts.
 *
 * @description This function executes a deployment script which deploys a given number of dummy WASM contracts.
 * The number of contracts to deploy is determined by the DUMMY_CONTRACTS_AMOUNT environment variable.
 * If the environment variable is not set, it defaults to 4 contracts.
 * The function returns an array of contract addresses.
 *
 * @returns {Promise<string[]>} An array of contract addresses.
 */
export async function deployDummyWASMContracts(
  amount: number = 1
): Promise<string[]> {
  try {
    const { stdout, stderr } = await execPromise(
      `bash test/scripts/deploy-dummy-wasm.sh -e .env -i ${amount}`
    );

    if (stderr) {
      console.error('Deployment script error:', stderr);
    }
    const ansiRegex = /\x1B\[[0-9;]*[mK]/g;
    const cleanedOutput = stdout.replace(ansiRegex, '').trim();
    return cleanedOutput.split('\n').filter((line) => line.startsWith('0x'));
  } catch (error) {
    console.error('Failed to execute deployment script:', error);
    throw error; // Fail the test setup if deployment fails
  }
}

/**
 * Evicts all contracts from the cache manager.
 *
 * @description This function evicts all contracts from the cache manager.
 * It is used in the test setup to ensure that the cache manager is empty before running tests.
 */
export async function evictAll() {
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const l2Owner = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );
  const cacheManagerContract = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    l2Owner
  );
  await cacheManagerContract.evictAll();
}

/**
 * Sets the cache size for the cache manager.
 *
 * @description This function retrieves the cache size from the environment
 * variable and updates the cache manager's cache size accordingly. It connects
 * to the cache manager contract using the address and owner specified in the
 * environment variables.
 */
export async function setCacheSize() {
  const cacheSize = process.env.CACHE_MANAGER_SIZE;
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const l2Owner = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );
  const cacheManagerContract = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    l2Owner
  );
  await cacheManagerContract.setCacheSize(cacheSize);
}

/**
 * Gets the minimum bid for a contract.
 *
 * @param contractAddress Address of the contract to get the minimum bid for
 * @returns Minimum bid for the contract
 */
export async function getMinBid(contractAddress: string) {
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const signer = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );
  const cacheManagerContract = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    signer
  );
  const contractCodeHash = hre.ethers.keccak256(
    await hre.ethers.provider.getCode(contractAddress)
  );
  return await cacheManagerContract['getMinBid(bytes32)'](contractCodeHash);
}

/**
 * Fills the cache with bids of specified amount.
 *
 * @param contracts Array of contract addresses to cache
 * @param bidAmount Amount in ETH to bid for each contract (defaults to 0.1)
 */
export async function fillCacheWithBids(
  contracts: string[],
  bidAmount: string = '0.01'
) {
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const signer = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );

  const cacheManager = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    signer
  );

  const bid = hre.ethers.parseEther(bidAmount);

  for (const contractAddress of contracts) {
    try {
      console.log(`Placing bid for contract ${contractAddress}`);
      await cacheManager.placeBid(contractAddress, { value: bid });
    } catch (error) {
      if (error instanceof Error && error.message.includes('AlreadyCached')) {
        console.log(`Contract ${contractAddress} is already cached`);
      } else {
        console.error(
          `Error placing bid for contract ${contractAddress}:`,
          error
        );
        break; // Stop the loop since cache is full.
      }
    }
  }
}

/**
 * Places a bid to the cache manager.
 *
 * @param contractAddress Address of the contract to bid on
 * @param bidAmount Amount in ETH to bid for the contract
 */
export async function placeBidToCacheManager(
  contractAddress: string,
  bidAmount: bigint
) {
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const signer = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );
  const cacheManager = new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    signer
  );
  await cacheManager.placeBid(contractAddress, { value: bidAmount });
}

/**
 * Gets a CacheManager contract instance connected to the signer
 *
 * @returns Contract instance of CacheManager
 */
export async function getCacheManager() {
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const signer = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );

  return new hre.ethers.Contract(
    cacheManagerAddress,
    cacheManagerABIJson.abi,
    signer
  );
}

/**
 * Gets an ArbWasmCache contract instance connected to the signer
 *
 * @returns Contract instance of ArbWasmCache
 */
export async function getArbWasmCache() {
  const arbWasmCacheAddress = hre.ethers.getAddress(
    process.env.ARB_WASM_CACHE_ADDRESS || '0x'
  );
  const signer = await hre.ethers.getSigner(
    process.env.ARBLOC_OWNER_ADD || '0x'
  );

  return new hre.ethers.Contract(
    arbWasmCacheAddress,
    arbWasmCacheABIJson.abi,
    signer
  );
}

/**
 * Checks if a contract is cached in the ArbWasmCache.
 *
 * @param contractAddress Address of the contract to check
 * @returns True if the contract is cached, false otherwise
 */
export async function isContractCached(contractAddress: string) {
  const contractCodeHash = hre.ethers.keccak256(
    await hre.ethers.provider.getCode(contractAddress)
  );
  const arbWasmCache = await getArbWasmCache();
  return await arbWasmCache.codehashIsCached(contractCodeHash);
}

/**
 * Deploys a Cache Manager Automation contract and returns its deployment details.
 *
 * @returns {Promise<CMADeployment>} An object containing the deployed Cache Manager Automation instance,
 * the cache manager address, and the owner signer.
 */
export async function deployCMASepolia(): Promise<void> {
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
}
