import { NetworksUserConfig } from 'hardhat/types';
import dotenv from 'dotenv';
dotenv.config();

// Only pass a signer when a real private key is configured.
// An empty or all-zero key makes Hardhat fail on tasks like `verify`.
const accountsFrom = (pk?: string): string[] => {
  const normalized = pk?.trim();
  return normalized && !/^(0x)?0+$/i.test(normalized) ? [normalized] : [];
};

export const networks: NetworksUserConfig = {
  hardhat: {
    // Local hardhat network
  },
  localL1: {
    url: process.env.ARB_LOCAL_L1_RPC || 'http://localhost:8545',
    accounts: accountsFrom(process.env.ARB_LOCAL_FUNDED_PK),
  },
  localArb: {
    url: process.env.ARB_LOCAL_RPC || 'http://localhost:8547',
    accounts: accountsFrom(process.env.ARB_LOCAL_FUNDED_PK),
  },
  arbitrumSepolia: {
    url: process.env.ARB_SEPOLIA_RPC,
    accounts: accountsFrom(process.env.ARB_SEPOLIA_FUNDED_PK),
  },
  arbitrumOne: {
    url: process.env.ARB_ONE_RPC,
    accounts: accountsFrom(process.env.ARB_ONE_FUNDED_PK),
  },
  superposition: {
    url: process.env.SUPERPOSITION_RPC,
    accounts: accountsFrom(process.env.SUPERPOSITION_FUNDED_PK),
  },
};

export const getNetworkConfig = (networkName: string) => {
  const config = networks[networkName];
  if (!config) {
    throw new Error(`Network ${networkName} not found in configuration`);
  }
  return config;
};
