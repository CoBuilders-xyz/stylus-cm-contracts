// Contract addresses by network
export const CACHE_MANAGER_ADDRESSES = {
  arbitrumSepolia: '0x0c9043d042ab52cfa8d0207459260040cca54253', // Replace with actual address
  localArb: '0x0f1f89aaf1c6fdb7ff9d361e4388f5f3997f12a8', // Replace with actual address
};

export const ARB_WASM_CACHE_ADDRESSES = {
  arbitrumSepolia: '0x0000000000000000000000000000000000000072', // Replace with actual address
  localArb: '0x0000000000000000000000000000000000000072', // Replace with actual address
};

// Contract configuration defaults
export const DEFAULT_CONFIG = {
  maxContractsPerUser: 100,
  maxUserFunds: '1000000000000000000', // 1 ETH in wei
  upgradeDelay: 86400, // 24 hours in seconds
};

// Gas limits for different operations
export const GAS_LIMITS = {
  deployment: 3000000,
  initialization: 500000,
  upgrade: 1000000,
};

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
