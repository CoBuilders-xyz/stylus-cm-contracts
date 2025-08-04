import { NetworksUserConfig } from 'hardhat/types';
import dotenv from 'dotenv';
dotenv.config();

export const networks: NetworksUserConfig = {
  hardhat: {
    // Local hardhat network
  },
  localL1: {
    url: 'http://localhost:8545',
    accounts: [process.env.ARB_LOCAL_FUNDED_PK || ''],
  },
  localArb: {
    url: 'http://localhost:8547',
    accounts: [process.env.ARB_LOCAL_FUNDED_PK || ''],
  },
  arbitrumSepolia: {
    url: process.env.ARB_SEPOLIA_RPC,
    accounts: [process.env.ARB_SEPOLIA_FUNDED_PK || ''],
  },
  arbitrumOne: {
    url: process.env.ARB_ONE_RPC,
    accounts: [process.env.ARB_ONE_FUNDED_PK || ''],
  },
  superposition: {
    url: process.env.SUPERPOSITION_RPC,
    accounts: [process.env.SUPERPOSITION_FUNDED_PK || ''],
  },
};

export const getNetworkConfig = (networkName: string) => {
  const config = networks[networkName];
  if (!config) {
    throw new Error(`Network ${networkName} not found in configuration`);
  }
  return config;
};
