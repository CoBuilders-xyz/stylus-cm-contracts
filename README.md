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

## Documentation

Detailed documentation for these contracts can be found in:

- The `mkdocs/docs` directory of the arb-research repository
- Local documentation server (follow instructions in arb-research README.md)

## Development and Testing

The repository includes comprehensive tests for both contracts. To run the tests:

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm run testCMA
```

## Deployment

For deployment instructions and configuration details, please refer to the main documentation in the arb-research repository.
