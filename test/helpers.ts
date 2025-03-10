import { exec } from 'child_process';
import util from 'util';
import hre from 'hardhat';
import { Signer } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();
const execPromise = util.promisify(exec);

import cacheManagerABIJson from '../src/abis/cacheManagerABI.json';
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

  const CacheManagerProxy = await hre.ethers.getContractFactory(
    'CacheManagerProxy'
  );
  const cacheManagerProxy = await CacheManagerProxy.deploy(cacheManagerAddress);
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
