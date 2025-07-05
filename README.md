# Stylus Cache Manager Contracts

This repository contains the smart contracts for the Stylus Cache Manager Automation system. The repository is part of the [arb-research](https://github.com/ifqbuilder/arb-research) monorepo.

## Overview

The Stylus Cache Manager Automation system consists of two main contracts:

1. **CacheManagerAutomation**: The core contract that handles the automation of cache management operations in the Stylus ecosystem.
2. **BiddingEscrow**: A specialized escrow contract based on OpenZeppelin's Escrow implementation.

### CacheManagerAutomation

The CacheManagerAutomation contract serves as the primary interface for managing cache operations in the Stylus system. It provides functionality for:

- Managing cache entries
- Handling automation tasks
- Coordinating with the escrow system for bidding operations
- Maintaining cache state and validity

Key features include:

- Automated cache management
- Bidding system integration
- State validation and updates
- Security controls and access management

### BiddingEscrow

The BiddingEscrow contract is built upon OpenZeppelin's standard Escrow contract implementation, with one key addition:

- `withdrawForBid`: A specialized withdrawal function specifically designed for our bidding system use case

The BiddingEscrow contract maintains the security and reliability of the standard OpenZeppelin implementation while adding the necessary functionality for our bidding mechanism.

## Project Structure

```
contracts/
├── core/                    # Core contract implementations
│   ├── CacheManagerAutomation.sol
│   └── BiddingEscrow.sol
├── interfaces/              # Contract interfaces
│   ├── ICacheManagerAutomation.sol
│   └── IExternalContracts.sol
└── mocks/                   # Mock contracts for testing

abis/                        # ABI Management System
├── generated/               # Generated ABIs from our contracts
│   ├── CacheManagerAutomation.abi.json
│   ├── BiddingEscrow.abi.json
│   └── I*.abi.json         # Interface ABIs
└── external/                # External contract ABIs
    ├── cacheManager.abi.json
    └── arbWasmCache.abi.json

config/                      # Configuration files
├── networks.ts              # Network configurations
├── constants.ts             # Contract constants
├── deployment-config.ts     # Deployment configurations
└── abis.ts                  # ABI management utilities

scripts/
├── deploy/                  # Deployment scripts
│   └── deploy-cache-manager-automation.ts
└── utils/                   # Utility scripts
    ├── generate-abis.ts     # Extract ABIs from compiled contracts
    ├── generate-types.ts    # Generate TypeScript types from ABIs
    └── verify-abis.ts       # Verify ABI compatibility

test/                        # Test files
├── CacheManagerAutomation.test.ts
├── CacheManager.test.ts
└── helpers.ts               # Test utilities

build/                       # Build artifacts
├── artifacts/               # Hardhat compilation artifacts
└── typechain-types/         # Generated TypeScript types
```

## Development

### Prerequisites

- Node.js >= 18
- npm or yarn

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

### Available Scripts

```bash
# Compile contracts
npm run compile

# Run all tests
npm run test

# Run specific tests
npm run test:cma    # CacheManagerAutomation tests
npm run test:cm     # CacheManager tests

# Deploy contracts
npm run deploy:local    # Deploy to local network
npm run deploy:sepolia  # Deploy to Arbitrum Sepolia

# ABI Management
npm run abis:generate   # Extract ABIs from compiled contracts
npm run abis:verify     # Verify ABI compatibility
npm run types:generate  # Generate TypeScript types from ABIs

# Complete build process
npm run build          # Compile + Generate ABIs + Generate Types

# Clean build artifacts
npm run clean

# Generate TypeScript types
npm run typechain
```

## ABI Management System

The repository includes a comprehensive ABI management system that:

- **Automatically extracts ABIs** from compiled contracts
- **Organizes ABIs** into generated (our contracts) and external (third-party contracts)
- **Generates TypeScript types** from all ABIs for type-safe contract interaction
- **Verifies ABI compatibility** to ensure contract integration works correctly

### ABI Structure

- `abis/generated/`: ABIs extracted from our compiled contracts
- `abis/external/`: ABIs for external contracts we interact with
- `config/abis.ts`: Centralized ABI management utilities

### Using ABIs in Code

```typescript
// Import the ABI management utilities
import { ABIs, getContractInstance } from './config/abis';

// Get a contract instance with type safety
const contract = getContractInstance(
  'CacheManagerAutomation',
  contractAddress,
  signer
);
```

## Testing

The repository includes comprehensive tests for both contracts. Tests are organized into:

- **Integration Tests**: End-to-end functionality testing
- **Unit Tests**: Individual function testing
- **Helper Functions**: Common test utilities

## Deployment

### Local Development

1. Start a local Arbitrum node (if testing against Arbitrum)
2. Configure your environment variables
3. Run deployment:

```bash
npm run deploy:local
```

### Testnet Deployment

1. Configure your private key for testnet deployment
2. Deploy to Arbitrum Sepolia:

```bash
npm run deploy:sepolia
```

### Configuration

Deployment configurations are managed in `config/deployment-config.ts`:

- Network-specific contract addresses
- Gas limits and deployment parameters
- Verification settings

## Architecture

### Non-Upgradeable Design

The contracts use a **non-upgradeable architecture** for security and simplicity:

- Direct contract deployment (no proxy patterns)
- Immutable contract logic once deployed
- Clear ownership and access control patterns

### Type Safety

The repository provides full TypeScript support:

- **Generated types** from all contract ABIs
- **Type-safe contract interactions**
- **Compile-time validation** of contract calls

## Documentation

Detailed documentation for these contracts can be found in:

- The `mkdocs/docs` directory of the arb-research repository
- Local documentation server (follow instructions in arb-research README.md)

## Security

This repository uses OpenZeppelin's battle-tested implementations for:

- Access control (Ownable)
- Reentrancy protection
- Safe math operations
- Escrow functionality

## Contributing

Please refer to the main arb-research repository for contribution guidelines.
