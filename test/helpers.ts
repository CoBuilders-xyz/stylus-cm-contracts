import { exec } from 'child_process';
import util from 'util';
import hre from 'hardhat';
import { Signer } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();
const execPromise = util.promisify(exec);

import cacheManagerABIJson from '../src/abis/cacheManagerABI.json';
import arbWasmCacheABIJson from '../src/abis/arbWasmCacheABI.json';
import type { CacheManagerProxy } from '../typechain-types';

export interface CMPDeployment {
  cacheManagerProxy: CacheManagerProxy;
  cacheManagerAddress: string;
  owner: Signer;
}

/**
 * Deploys a Cache Manager Proxy contract and returns its deployment details.
 *
 * @returns {Promise<CMPDeployment>} An object containing the deployed Cache Manager Proxy instance,
 * the cache manager address, and the owner signer.
 */
export async function deployCMP(): Promise<CMPDeployment> {
  const [owner] = await hre.ethers.getSigners();
  const cacheManagerAddress = hre.ethers.getAddress(
    process.env.CACHE_MANAGER_ADDRESS || '0x'
  );
  const arbWasmCacheAddress = hre.ethers.getAddress(
    process.env.ARB_WASM_CACHE_ADDRESS || '0x'
  );

  const CacheManagerProxy = await hre.ethers.getContractFactory(
    'CacheManagerProxy'
  );
  const cacheManagerProxy = await CacheManagerProxy.deploy(
    cacheManagerAddress,
    arbWasmCacheAddress
  );
  return { cacheManagerProxy, cacheManagerAddress, owner };
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
export async function deployDummyWASMContracts(): Promise<string[]> {
  try {
    const dummyContractsAmount = parseInt(
      process.env.DUMMY_CONTRACTS_AMOUNT || '4'
    );
    if (dummyContractsAmount % 2 !== 0 || dummyContractsAmount < 2) {
      throw new Error(
        'DUMMY_CONTRACTS_AMOUNT environment variable must be an even number greater than 2'
      );
    }
    const { stdout, stderr } = await execPromise(
      `bash scripts/deploy-dummy-wasm.sh ${dummyContractsAmount}`
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
 * Fills the cache with bids of specified amount.
 *
 * @param contracts Array of contract addresses to cache
 * @param bidAmount Amount in ETH to bid for each contract (defaults to 0.1)
 */
export async function fillCacheWithBids(
  contracts: string[],
  bidAmount: string = '0.1'
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
      await cacheManager.placeBid(contractAddress, { value: bid });
    } catch (error) {
      if (error instanceof Error && error.message.includes('AlreadyCached')) {
        console.log(`Contract ${contractAddress} is already cached`);
      } else {
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
