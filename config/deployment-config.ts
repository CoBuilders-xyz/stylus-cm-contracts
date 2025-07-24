import {
  CACHE_MANAGER_ADDRESSES,
  ARB_WASM_CACHE_ADDRESSES,
  DEFAULT_CONFIG,
} from './constants';

export interface DeploymentConfig {
  cacheManagerAddress: string;
  arbWasmCacheAddress: string;
  maxContractsPerUser: number;
  maxUserFunds: string;
  upgradeDelay: number;
  verify: boolean;
}

export const deploymentConfigs: Record<string, DeploymentConfig> = {
  arbitrumOne: {
    cacheManagerAddress: CACHE_MANAGER_ADDRESSES.arbitrumOne,
    arbWasmCacheAddress: ARB_WASM_CACHE_ADDRESSES.arbitrumOne,
    maxContractsPerUser: DEFAULT_CONFIG.maxContractsPerUser,
    maxUserFunds: DEFAULT_CONFIG.maxUserFunds,
    upgradeDelay: DEFAULT_CONFIG.upgradeDelay,
    verify: true,
  },
  arbitrumSepolia: {
    cacheManagerAddress: CACHE_MANAGER_ADDRESSES.arbitrumSepolia,
    arbWasmCacheAddress: ARB_WASM_CACHE_ADDRESSES.arbitrumSepolia,
    maxContractsPerUser: DEFAULT_CONFIG.maxContractsPerUser,
    maxUserFunds: DEFAULT_CONFIG.maxUserFunds,
    upgradeDelay: DEFAULT_CONFIG.upgradeDelay,
    verify: true,
  },
  localArb: {
    cacheManagerAddress: CACHE_MANAGER_ADDRESSES.localArb,
    arbWasmCacheAddress: ARB_WASM_CACHE_ADDRESSES.localArb,
    maxContractsPerUser: DEFAULT_CONFIG.maxContractsPerUser,
    maxUserFunds: DEFAULT_CONFIG.maxUserFunds,
    upgradeDelay: 0, // No delay for local testing
    verify: false,
  },
  superposition: {
    cacheManagerAddress: CACHE_MANAGER_ADDRESSES.superposition,
    arbWasmCacheAddress: ARB_WASM_CACHE_ADDRESSES.superposition,
    maxContractsPerUser: DEFAULT_CONFIG.maxContractsPerUser,
    maxUserFunds: DEFAULT_CONFIG.maxUserFunds,
    upgradeDelay: DEFAULT_CONFIG.upgradeDelay,
    verify: true,
  },
  hardhat: {
    cacheManagerAddress: '0x1234567890123456789012345678901234567890',
    arbWasmCacheAddress: '0x1234567890123456789012345678901234567890',
    maxContractsPerUser: DEFAULT_CONFIG.maxContractsPerUser,
    maxUserFunds: DEFAULT_CONFIG.maxUserFunds,
    upgradeDelay: 0,
    verify: false,
  },
};

export const getDeploymentConfig = (networkName: string): DeploymentConfig => {
  const config = deploymentConfigs[networkName];
  if (!config) {
    throw new Error(`Deployment config for network ${networkName} not found`);
  }
  return config;
};
