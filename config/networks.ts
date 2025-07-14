import { NetworksUserConfig } from 'hardhat/types';
import dotenv from 'dotenv';
dotenv.config();

export const networks: NetworksUserConfig = {
  hardhat: {
    // Local hardhat network
  },
  localL1: {
    url: 'http://localhost:8545',
    accounts: [process.env.ARBPRE_PK || ''],
  },
  localArb: {
    url: 'http://localhost:8547',
    accounts: [process.env.ARBPRE_PK || '', process.env.ARBLOC_OWNER_PK || ''],
  },
  arbitrumSepolia: {
    url: process.env.SEPOLIA_RPC,
    accounts: [process.env.SEPOLIA_USER_PK || ''],
  },
  arbitrumOne: {
    url: process.env.ARBITRUM_RPC,
    accounts: [process.env.ARBITRUM_USER_PK || ''],
  },
};

export const getNetworkConfig = (networkName: string) => {
  const config = networks[networkName];
  if (!config) {
    throw new Error(`Network ${networkName} not found in configuration`);
  }
  return config;
};
