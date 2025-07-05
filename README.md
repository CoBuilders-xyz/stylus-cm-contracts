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

config/                      # Configuration files
├── networks.ts              # Network configurations
├── constants.ts             # Contract constants
└── deployment-config.ts     # Deployment configurations

scripts/
└── deploy/                  # Deployment scripts
    └── deploy-cache-manager-automation.ts

test/                        # Test files
├── CacheManagerAutomation.test.ts
├── CacheManager.test.ts
└── helpers.ts               # Test utilities
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

# Clean build artifacts
npm run clean

# Generate TypeScript types
npm run typechain
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

## Documentation

Detailed documentation for these contracts can be found in:

- The `mkdocs/docs` directory of the arb-research repository
- Local documentation server (follow instructions in arb-research README.md)

## Security

This repository uses OpenZeppelin's battle-tested implementations for:

- Upgradeable contracts (UUPS pattern)
- Access control
- Reentrancy protection
- Safe math operations

## Contributing

Please refer to the main arb-research repository for contribution guidelines.
