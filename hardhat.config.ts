import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import { networks } from './config/networks';

const config: HardhatUserConfig = {
  networks,
  solidity: {
    compilers: [
      {
        version: '0.8.30',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
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
