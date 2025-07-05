import { promises as fs } from 'fs';
import path from 'path';
import { ethers } from 'ethers';

// Import generated ABIs (these will be available after compilation)
let CacheManagerAutomationABI: any[] = [];
let BiddingEscrowABI: any[] = [];

// Import external ABIs
import cacheManagerABI from '../abis/external/cacheManager.abi.json';
import arbWasmCacheABI from '../abis/external/arbWasmCache.abi.json';

// ABI Registry
export const ABIs = {
  // Generated ABIs (our contracts)
  CacheManagerAutomation: CacheManagerAutomationABI,
  BiddingEscrow: BiddingEscrowABI,

  // External ABIs
  CacheManager: cacheManagerABI.abi,
  ArbWasmCache: arbWasmCacheABI.abi,
};

// Contract Interface Registry
export const Interfaces = {
  CacheManagerAutomation: () =>
    new ethers.Interface(ABIs.CacheManagerAutomation),
  BiddingEscrow: () => new ethers.Interface(ABIs.BiddingEscrow),
  CacheManager: () => new ethers.Interface(ABIs.CacheManager),
  ArbWasmCache: () => new ethers.Interface(ABIs.ArbWasmCache),
};

// Dynamic ABI loading for generated contracts
export async function loadGeneratedABIs() {
  try {
    const generatedPath = path.join(__dirname, '../abis/generated');

    // Load CacheManagerAutomation ABI
    try {
      const cmaABI = await fs.readFile(
        path.join(generatedPath, 'CacheManagerAutomation.abi.json'),
        'utf8'
      );
      ABIs.CacheManagerAutomation = JSON.parse(cmaABI);
    } catch (error) {
      console.warn('CacheManagerAutomation ABI not found in generated ABIs');
    }

    // Load BiddingEscrow ABI
    try {
      const escrowABI = await fs.readFile(
        path.join(generatedPath, 'BiddingEscrow.abi.json'),
        'utf8'
      );
      ABIs.BiddingEscrow = JSON.parse(escrowABI);
    } catch (error) {
      console.warn('BiddingEscrow ABI not found in generated ABIs');
    }

    console.log('✅ Generated ABIs loaded successfully');
  } catch (error) {
    console.warn('⚠️  Could not load generated ABIs:', error);
  }
}

// Utility function to get contract instance
export function getContractInstance(
  contractName: keyof typeof ABIs,
  address: string,
  signer: ethers.Signer | ethers.Provider
): ethers.Contract {
  const abi = ABIs[contractName];
  if (!abi || abi.length === 0) {
    throw new Error(`ABI not found for contract: ${contractName}`);
  }

  return new ethers.Contract(address, abi, signer);
}

// Export commonly used ABIs for backward compatibility
export { cacheManagerABI, arbWasmCacheABI };
