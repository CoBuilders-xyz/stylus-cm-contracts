import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import dotenv from 'dotenv';
dotenv.config();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {},
    localL1: {
      url: 'http://localhost:8545',
      accounts: [process.env.ARBPRE_PK || ''],
    },
    localArb: {
      url: 'http://localhost:8547',
      accounts: [
        process.env.ARBPRE_PK || '',
        process.env.ARBLOC_OWNER_PK || '',
      ],
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.28',
      },
      {
        version: '0.8.19',
      },
    ],
  },
  paths: {
    sources: './src/contracts',
  },
};

export default config;
