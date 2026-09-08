import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-ignition-ethers';
import { networks } from './config/networks';
import { ignition } from './config/ignition';

const config: HardhatUserConfig = {
  networks,
  ignition,
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || '',
  },
  solidity: {
    compilers: [
      {
        version: '0.8.30',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: 'paris',
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    artifacts: 'build/artifacts',
    cache: 'build/cache',
    tests: './test',
  },
  typechain: {
    outDir: 'build/typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
