import { expect } from 'chai';
import hre from 'hardhat';
import { Wallet, JsonRpcProvider, Signer } from 'ethers';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import {
  CMADeployment,
  deployDummyWASMContracts,
  deployCMA,
  evictAll,
  setCacheSize,
  getMinBid,
  fillCacheWithBids,
  placeBidToCacheManager,
  isContractCached,
} from './helpers';
import { CacheManagerMonitor } from './scripts/monitor';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

dotenv.config();

describe('cacheManagerAutomation', async function () {
  // Common test variables
  let cmaDeployment: CMADeployment;
  let dummyContracts: string[];
  let monitor: CacheManagerMonitor;

  // Test constants
  const DEFAULT_MAX_BID = hre.ethers.parseEther('0.001');
  const DEFAULT_WALLET_FUNDING = hre.ethers.parseEther('0.01');
  const DEFAULT_BID_FUNDING = hre.ethers.parseEther('0.005');

  // Wallets
  var owner: HardhatEthersSigner;
  var user1: HardhatEthersSigner;

  // Helper functions for tests
  async function insertContract(
    contractAddress: string,
    maxBid = DEFAULT_MAX_BID,
    bidFunding = DEFAULT_BID_FUNDING,
    enabled = true,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || user1;
    return cmaDeployment.cacheManagerAutomation
      .connect(signer)
      .insertOrUpdateContract(contractAddress, maxBid, enabled, {
        value: bidFunding,
      });
  }

  async function createAndFundWallet(fundAmount = DEFAULT_WALLET_FUNDING) {
    const [mainWallet] = await hre.ethers.getSigners();
    const wallet = new hre.ethers.Wallet(
      hre.ethers.Wallet.createRandom().privateKey,
      mainWallet.provider
    );

    // Fund the new wallet from the main wallet
    const tx = await mainWallet.sendTransaction({
      to: wallet.address,
      value: fundAmount,
    });
    await tx.wait();

    return wallet;
  }

  async function createAndFundWallets(
    count: number,
    fundAmount = hre.ethers.parseEther('0.01')
  ) {
    const wallets: Wallet[] = [];
    for (let i = 0; i < count; i++) {
      wallets.push(await createAndFundWallet(fundAmount));
    }
    return wallets;
  }

  // Verify helper functions
  async function verifyContractExists(
    userAddress: string,
    contractAddress: string,
    expectedMaxBid: bigint
  ) {
    const userContracts =
      await cmaDeployment.cacheManagerAutomation.getUserContracts(userAddress);
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.not.be.undefined;
    expect(contract?.contractAddress).to.equal(contractAddress);
    expect(contract?.maxBid).to.equal(expectedMaxBid);
    return contract;
  }

  async function verifyContractRemoved(
    userAddress: string,
    contractAddress: string
  ) {
    const userContracts =
      await cmaDeployment.cacheManagerAutomation.getUserContracts(userAddress);
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.be.undefined;
  }

  async function verifyUserInAddressList(
    userAddress: string,
    shouldExist: boolean
  ) {
    const userAddresses = await cmaDeployment.cacheManagerAutomation
      .connect(owner)
      .getUserAddresses();
    if (shouldExist) {
      expect(userAddresses.includes(userAddress)).to.equal(true);
    } else {
      expect(userAddresses.includes(userAddress)).to.equal(false);
    }
  }

  async function verifyUserBalance(
    expectedBalance: bigint,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || user1;
    const userBalance = await cmaDeployment.cacheManagerAutomation
      .connect(signer)
      .getUserBalance();
    expect(userBalance).to.equal(expectedBalance);
  }

  // Setup before all tests
  before(async function () {
    console.log('');
    console.log('Setup');
    console.log('---------------------------------------');
    console.log(
      `Setting cache size to: ${
        parseFloat(process.env.CACHE_MANAGER_SIZE || '0') / 1e6
      } MB`
    );

    // Setup signers
    owner = (await hre.ethers.getSigners())[0];
    user1 = (await hre.ethers.getSigners())[1];
    const ownerBalance = hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(owner.address)
    );
    const user1Balance = hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(user1.address)
    );

    console.log('---------------------------------------');
    console.log('Addresses and Balances');
    console.log('----------------');
    console.log(`Owner: ${owner.address} - ${ownerBalance} ETH`);
    console.log(`User 1: ${user1.address} - ${user1Balance} ETH`);
    console.log('---------------------------------------');

    await setCacheSize();
    dummyContracts = await deployDummyWASMContracts();
    console.log('Dummy WASM Contracts:');
    console.log(dummyContracts.join('\n'));

    monitor = new CacheManagerMonitor(
      '0x0000000000000000000000000000000000000000',
      new JsonRpcProvider(process.env.RPC),
      uuidv4()
    );
    await monitor.startMonitoring(true);
    console.log('---------------------------------------');
  });

  // Setup before each test
  beforeEach(async function () {
    // Deploys a new CMA for clean start. No need to remove contracts between tests.
    cmaDeployment = await deployCMA();
    // console.log(
    //   `  CMAAddress: ${await cmaDeployment.cacheManagerAutomation.getAddress()}`
    // );

    // Evict all contracts from cache for clean start.
    await evictAll();

    // Update monitor with new CMA address
    await monitor.setTestId(uuidv4());
    await monitor.setContractAddress(
      await cmaDeployment.cacheManagerAutomation.getAddress()
    );
    await monitor.startMonitoring();
  });

  // Cleanup after each test
  afterEach(async () => {
    // Add small delay to allow events to be processed
    // await new Promise((resolve) => setTimeout(resolve, 5000));
    await monitor.stopMonitoring();
  });

  describe('Deployment', async function () {
    describe('First Deployment', async function () {
      it('Should set the right owner', async function () {
        expect(await cmaDeployment.cacheManagerAutomation.owner()).to.equal(
          await cmaDeployment.owner.getAddress()
        );
      });
      it('Should set the right cache manager address', async function () {
        expect(
          await cmaDeployment.cacheManagerAutomation.cacheManager()
        ).to.equal(cmaDeployment.cacheManagerAddress);
      });
      it('Should set the right arb wasm cache address', async function () {
        expect(
          await cmaDeployment.cacheManagerAutomation.arbWasmCache()
        ).to.equal(cmaDeployment.arbWasmCacheAddress);
      });
    });
    describe('Upgradable', async function () {
      it('Should be upgradable [TODO]', async function () {});
    });
  });

  describe('Contract Management', function () {
    describe('Contract Insertion', function () {
      it('Should insert a contract to CMA', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);

        await expect(
          insertContract(
            contractToCacheAddress,
            DEFAULT_MAX_BID,
            DEFAULT_BID_FUNDING,
            true
          )
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
          .withArgs(user1.address, contractToCacheAddress, DEFAULT_MAX_BID);

        await verifyContractExists(
          user1.address,
          contractToCacheAddress,
          DEFAULT_MAX_BID
        );
        await verifyUserBalance(DEFAULT_BID_FUNDING);
        await verifyUserInAddressList(user1.address, true);
      });

      it('Should insert several contracts to CMA', async function () {
        const dummyContractsAmount = dummyContracts.length;
        const contractAddresses = [];
        const biddingFunds = [];

        // Add multiple contracts to CMA
        for (let i = 0; i < dummyContractsAmount; i++) {
          const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
          contractAddresses.push(contractAddress);
          const funding =
            BigInt(Math.floor(Math.random() * Number(DEFAULT_MAX_BID))) +
            2n * DEFAULT_MAX_BID;
          biddingFunds.push(funding);

          await expect(
            insertContract(contractAddress, DEFAULT_MAX_BID, funding)
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
            .withArgs(user1.address, contractAddress, DEFAULT_MAX_BID);
        }

        // Ensure all contracts were added
        let userContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        expect(userContracts.length).to.equal(dummyContractsAmount);

        // Validate stored contract data
        for (let i = 0; i < dummyContractsAmount; i++) {
          verifyContractExists(
            user1.address,
            contractAddresses[i],
            DEFAULT_MAX_BID
          );
        }

        // Verify user balance
        verifyUserBalance(biddingFunds.reduce((a, b) => a + b));

        // Check user was added to userAddresses
        await verifyUserInAddressList(user1.address, true);
      });

      it('Should insert several contracts from diff wallets to CMA', async function () {
        const dummyContractsAmount = dummyContracts.length;
        const contractAddresses = [];
        const biddingFunds = [];

        // Generate additional wallets
        const extraWallets = await createAndFundWallets(dummyContractsAmount);

        // Each wallet adds a contract
        for (let i = 0; i < dummyContractsAmount; i++) {
          const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
          contractAddresses.push(contractAddress);
          const funding =
            BigInt(Math.floor(Math.random() * Number(DEFAULT_MAX_BID))) +
            2n * DEFAULT_MAX_BID;
          biddingFunds.push(funding);

          await expect(
            insertContract(
              contractAddress,
              DEFAULT_MAX_BID,
              funding,
              true,
              extraWallets[i]
            )
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
            .withArgs(
              extraWallets[i].address,
              contractAddress,
              DEFAULT_MAX_BID
            );

          verifyUserBalance(funding, extraWallets[i]);
        }

        // Ensure all contracts were added correctly for each wallet
        for (let i = 0; i < dummyContractsAmount; i++) {
          const userContracts =
            await cmaDeployment.cacheManagerAutomation.getUserContracts(
              extraWallets[i].address
            );
          const userBalance = await cmaDeployment.cacheManagerAutomation
            .connect(extraWallets[i])
            .getUserBalance();

          expect(userContracts.length).to.equal(1);
          expect(userContracts[0].contractAddress).to.equal(
            contractAddresses[i]
          );
          expect(userContracts[0].maxBid).to.equal(DEFAULT_MAX_BID);
          expect(userBalance).to.equal(biddingFunds[i]);

          // Check user was added to userAddresses
          const userAddresses = await cmaDeployment.cacheManagerAutomation
            .connect(owner)
            .getUserAddresses();
          expect(
            userAddresses.filter((address) =>
              extraWallets.map((wallet) => wallet.address).includes(address)
            ).length
          ).to.equal(dummyContractsAmount);
        }
      });
    });
    describe('Contract Removal', function () {
      it('Should remove a contract from CMA', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);

        // Add contract first
        await insertContract(contractToCacheAddress);

        // Remove the contract and check event emission
        await expect(
          cmaDeployment.cacheManagerAutomation.removeContract(
            contractToCacheAddress
          )
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user1.address, contractToCacheAddress);

        await verifyContractRemoved(user1.address, contractToCacheAddress);
        await verifyUserInAddressList(user1.address, false);
        await verifyUserBalance(DEFAULT_BID_FUNDING);
      });

      it('Should remove all contracts from CMA', async function () {
        const dummyContractsAmount = 3; // Use just 3 contracts for simplicity
        const contractAddresses = [];
        const totalFunding = DEFAULT_BID_FUNDING * BigInt(dummyContractsAmount);

        // Add multiple contracts to CMA
        for (let i = 0; i < dummyContractsAmount; i++) {
          const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
          contractAddresses.push(contractAddress);
          await insertContract(contractAddress);
        }

        // Remove all contracts and check for event emissions
        await expect(cmaDeployment.cacheManagerAutomation.removeAllContracts())
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user1.address, contractAddresses[0]) // Checks the first contract removed
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user1.address, contractAddresses[1]) // Checks the second contract removed
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user1.address, contractAddresses[2]); // Checks the third contract removed

        // Ensure all contracts were removed
        await verifyContractRemoved(user1.address, contractAddresses[0]);
        await verifyContractRemoved(user1.address, contractAddresses[1]);
        await verifyContractRemoved(user1.address, contractAddresses[2]);
        await verifyUserInAddressList(user1.address, false);

        // User balance should be the sum of all bids
        await verifyUserBalance(totalFunding);
      });

      it('Should remove some contracts from diff wallets while others remain', async function () {
        // Setup: Create wallets and add contracts
        const walletCount = 4; // Using fewer wallets for simplicity
        const extraWallets = await createAndFundWallets(walletCount);
        const contractAddresses = [];

        // Each wallet adds a contract
        for (let i = 0; i < walletCount; i++) {
          const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
          contractAddresses.push(contractAddress);
          await insertContract(
            contractAddress,
            DEFAULT_MAX_BID,
            DEFAULT_BID_FUNDING,
            true,
            extraWallets[i]
          );
        }

        // Remove contracts from first half of wallets
        const halfCount = Math.floor(walletCount / 2);
        for (let i = 0; i < halfCount; i++) {
          await expect(
            cmaDeployment.cacheManagerAutomation
              .connect(extraWallets[i])
              .removeContract(contractAddresses[i])
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
            .withArgs(extraWallets[i].address, contractAddresses[i]);
        }

        // Verify: First half of wallets should have no contracts
        for (let i = 0; i < halfCount; i++) {
          await verifyContractRemoved(
            extraWallets[i].address,
            contractAddresses[i]
          );
          await verifyUserInAddressList(extraWallets[i].address, false);
        }

        // Verify: Second half of wallets should still have their contracts
        for (let i = halfCount; i < walletCount; i++) {
          await verifyContractExists(
            extraWallets[i].address,
            contractAddresses[i],
            DEFAULT_MAX_BID
          );
          await verifyUserInAddressList(extraWallets[i].address, true);
        }
      });
    });
    describe('Contract Updates', function () {
      it('Should update a contract max bid', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const initialMaxBid = hre.ethers.parseEther('0.001');
        const updatedMaxBid = hre.ethers.parseEther('0.005');
        const bidFunding = hre.ethers.parseEther('0.01');

        // First insert the contract
        await insertContract(contractToCacheAddress, initialMaxBid, bidFunding);

        // Verify initial state
        await verifyContractExists(
          user1.address,
          contractToCacheAddress,
          initialMaxBid
        );

        // Update the max bid
        await expect(
          cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            updatedMaxBid,
            true
          )
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractUpdated')
          .withArgs(user1.address, contractToCacheAddress, updatedMaxBid);

        // Verify the contract was updated
        await verifyContractExists(
          user1.address,
          contractToCacheAddress,
          updatedMaxBid
        );
        await verifyUserBalance(bidFunding);
        await verifyUserInAddressList(user1.address, true);
      });

      it('Should update a contract max bid with additional funds', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const initialMaxBid = hre.ethers.parseEther('0.001');
        const updatedMaxBid = hre.ethers.parseEther('0.005');
        const initialFunding = hre.ethers.parseEther('0.01');
        const additionalFunding = hre.ethers.parseEther('0.02');

        // First insert the contract
        await insertContract(
          contractToCacheAddress,
          initialMaxBid,
          initialFunding
        );

        // Update the max bid with additional funds
        await expect(
          cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            updatedMaxBid,
            true,
            {
              value: additionalFunding,
            }
          )
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractUpdated')
          .withArgs(user1.address, contractToCacheAddress, updatedMaxBid);

        // Verify the contract was updated
        await verifyContractExists(
          user1.address,
          contractToCacheAddress,
          updatedMaxBid
        );
        await verifyUserBalance(initialFunding + additionalFunding);
        await verifyUserInAddressList(user1.address, true);
      });

      it('Should update a contract enabled status', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.001');
        const bidFunding = hre.ethers.parseEther('0.01');

        // First insert the contract as enabled
        await insertContract(contractToCacheAddress, maxBid, bidFunding);

        // Verify initial state
        let userContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        let contract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(contract?.enabled).to.be.true;

        // Update the contract to disabled
        await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          false
        );

        // Verify the contract was disabled
        userContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        contract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(contract?.enabled).to.be.false;

        // Update back to enabled
        await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          true
        );

        // Verify the contract was enabled again
        userContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        contract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(contract?.enabled).to.be.true;
      });
    });
    describe('Contract Mixed Operations', function () {
      it('Should add and remove contracts from diff wallets in random order', async function () {
        // Setup: Create wallets and prepare contract addresses
        const walletCount = 4; // Reduced for simplicity
        const extraWallets = await createAndFundWallets(
          walletCount,
          hre.ethers.parseEther('0.005')
        ); // Reduced funding
        const contractAddresses = dummyContracts
          .slice(0, walletCount)
          .map((c) => hre.ethers.getAddress(c));
        const maxBid = hre.ethers.parseEther('0.001'); // Reduced max bid
        const biddingFunds = hre.ethers.parseEther('0.002'); // Reduced bidding funds

        // Shuffle indexes for random order operations
        const shuffledIndexes = [...Array(walletCount).keys()].sort(
          () => Math.random() - 0.5
        );

        // Add contracts in random order
        for (const i of shuffledIndexes) {
          await expect(
            insertContract(
              contractAddresses[i],
              maxBid,
              biddingFunds,
              true,
              extraWallets[i]
            )
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
            .withArgs(extraWallets[i].address, contractAddresses[i], maxBid);

          // Verify contract was added correctly
          await verifyContractExists(
            extraWallets[i].address,
            contractAddresses[i],
            maxBid
          );
          await verifyUserInAddressList(extraWallets[i].address, true);
        }

        // Shuffle again for random removal order
        const removalIndexes = [...shuffledIndexes].sort(
          () => Math.random() - 0.5
        );

        // Remove contracts in different random order
        for (const i of removalIndexes) {
          await expect(
            cmaDeployment.cacheManagerAutomation
              .connect(extraWallets[i])
              .removeContract(contractAddresses[i])
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
            .withArgs(extraWallets[i].address, contractAddresses[i]);

          // Verify contract was removed correctly
          await verifyContractRemoved(
            extraWallets[i].address,
            contractAddresses[i]
          );
          await verifyUserInAddressList(extraWallets[i].address, false);

          // Check balance using the correct wallet connection
          const userBalance = await cmaDeployment.cacheManagerAutomation
            .connect(extraWallets[i])
            .getUserBalance();
          expect(userBalance).to.equal(biddingFunds);
        }

        // Final verification that all users have been removed from the address list
        await verifyUserInAddressList(extraWallets[0].address, false);
        await verifyUserInAddressList(extraWallets[1].address, false);
        await verifyUserInAddressList(extraWallets[2].address, false);
        await verifyUserInAddressList(extraWallets[3].address, false);
      });
    });
    describe('Contract Enabling/Disabling', function () {
      it('Should allow enabling and disabling contracts', async function () {
        const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.001');
        const bidFunding = hre.ethers.parseEther('0.01');

        // Add contract as enabled
        await insertContract(contractAddress, maxBid, bidFunding);

        // Disable the contract
        await cmaDeployment.cacheManagerAutomation.setContractEnabled(
          contractAddress,
          false
        );

        // Verify contract is disabled
        const userContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        const contract = userContracts.find(
          (c) => c.contractAddress === contractAddress
        );
        expect(contract?.enabled).to.be.false;

        // Re-enable the contract
        await cmaDeployment.cacheManagerAutomation.setContractEnabled(
          contractAddress,
          true
        );

        // Verify contract is enabled again
        const updatedContracts =
          await cmaDeployment.cacheManagerAutomation.getUserContracts(
            user1.address
          );
        const updatedContract = updatedContracts.find(
          (c) => c.contractAddress === contractAddress
        );
        expect(updatedContract?.enabled).to.be.true;
      });
    });
  });

  describe('Balance Management', function () {
    describe('Fund Balance', function () {
      it('Should allow users to fund their balance', async function () {
        const [user] = await hre.ethers.getSigners();
        const fundAmount = hre.ethers.parseEther('0.5');

        await expect(
          cmaDeployment.cacheManagerAutomation.fundBalance({
            value: fundAmount,
          })
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'BalanceUpdated')
          .withArgs(user.address, fundAmount);

        const userBalance =
          await cmaDeployment.cacheManagerAutomation.getUserBalance();
        expect(userBalance).to.equal(fundAmount);
      });

      it('Should revert when funding with less than MIN_BID_AMOUNT', async function () {
        await expect(
          cmaDeployment.cacheManagerAutomation.fundBalance({ value: 0 })
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'InvalidBid'
        );
      });

      it('Should accumulate balance when funding multiple times', async function () {
        const fundAmount1 = hre.ethers.parseEther('0.1');
        const fundAmount2 = hre.ethers.parseEther('0.2');

        await cmaDeployment.cacheManagerAutomation.fundBalance({
          value: fundAmount1,
        });
        await cmaDeployment.cacheManagerAutomation.fundBalance({
          value: fundAmount2,
        });

        const userBalance =
          await cmaDeployment.cacheManagerAutomation.getUserBalance();
        expect(userBalance).to.equal(fundAmount1 + fundAmount2);
      });
    });

    describe('Withdraw Balance', function () {
      it('Should allow users to withdraw their balance', async function () {
        const [user] = await hre.ethers.getSigners();
        const fundAmount = hre.ethers.parseEther('0.5');

        // Fund the balance first
        await cmaDeployment.cacheManagerAutomation.fundBalance({
          value: fundAmount,
        });

        // Check user's ETH balance before withdrawal
        const balanceBefore = await hre.ethers.provider.getBalance(
          user.address
        );

        // Withdraw and track gas costs
        const tx = await cmaDeployment.cacheManagerAutomation.withdrawBalance();
        const receipt = await tx.wait();
        const gasUsed = receipt ? receipt.gasUsed * receipt.gasPrice : 0n;

        // Check user's ETH balance after withdrawal
        const balanceAfter = await hre.ethers.provider.getBalance(user.address);

        // Verify balance increased by the expected amount (accounting for gas)
        expect(balanceAfter).to.be.closeTo(
          balanceBefore + fundAmount - gasUsed,
          hre.ethers.parseEther('0.0001') // Allow for small rounding differences
        );

        // Verify user balance in contract is now zero
        const userBalance =
          await cmaDeployment.cacheManagerAutomation.getUserBalance();
        expect(userBalance).to.equal(0);
      });

      it('Should revert when withdrawing with zero balance', async function () {
        await expect(
          cmaDeployment.cacheManagerAutomation.withdrawBalance()
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'InsufficientBalance'
        );
      });

      it('Should emit BalanceUpdated event when withdrawing', async function () {
        const fundAmount = hre.ethers.parseEther('0.5');
        const [user] = await hre.ethers.getSigners();

        // Fund the balance first
        await cmaDeployment.cacheManagerAutomation.fundBalance({
          value: fundAmount,
        });

        // Withdraw and check for event
        await expect(cmaDeployment.cacheManagerAutomation.withdrawBalance())
          .to.emit(cmaDeployment.cacheManagerAutomation, 'BalanceUpdated')
          .withArgs(user.address, 0);
      });
    });
  });

  describe('Bidding Mechanism', function () {
    describe('Automation', function () {
      describe('checkUpkeep', function () {
        it('Should return upkeepNeeded=false when no contracts are registered', async function () {
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=false when minBid exceeds maxBid', async function () {
          // Setup: Add contract with maxBid of 0.1 ETH
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Make minBid > maxBid by filling cache with higher bids
          const contractsToFill = dummyContracts
            .slice(1, 4)
            .map((contract) => hre.ethers.getAddress(contract));
          await fillCacheWithBids(contractsToFill, '0.2');

          // Check upkeep
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=true when minBid < maxBid and contract is not cached', async function () {
          // Setup: Add contract with sufficient maxBid
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Check upkeep
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.true;
        });

        it('Should return upkeepNeeded=false when minBid < maxBid and contract is cached', async function () {
          // Setup: Add contract and cache it
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Cache the contract before checking upkeep
          await placeBidToCacheManager(
            contractToCacheAddress,
            hre.ethers.parseEther('0.1')
          );

          // Check upkeep
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=true for multiple eligible contracts', async function () {
          // Setup: Add multiple contracts with sufficient maxBid
          const contractAddresses = dummyContracts
            .slice(0, 3)
            .map((contract) => hre.ethers.getAddress(contract));
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          for (const contractAddress of contractAddresses) {
            await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
              contractAddress,
              maxBid,
              true,
              { value: biddingFunds / BigInt(contractAddresses.length) }
            );
          }

          // Check upkeep
          const { upkeepNeeded, performData } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.true;

          // Verify performData contains the correct number of contracts
          const totalContracts = hre.ethers.AbiCoder.defaultAbiCoder().decode(
            ['uint256'],
            performData
          )[0];
          expect(totalContracts).to.equal(BigInt(contractAddresses.length));
        });

        it('Should return upkeepNeeded=false when all contracts are disabled', async function () {
          // Setup: Add contracts but disable them
          const contractAddresses = dummyContracts
            .slice(0, 3)
            .map((contract) => hre.ethers.getAddress(contract));
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          for (const contractAddress of contractAddresses) {
            await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
              contractAddress,
              maxBid,
              false, // disabled
              { value: biddingFunds / BigInt(contractAddresses.length) }
            );
          }

          // Check upkeep
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=true when user has insufficient balance', async function () {
          // Setup: Add contract with maxBid but insufficient balance
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.6');
          const contractToCacheAddresses = dummyContracts.slice(1, 3);
          await fillCacheWithBids(contractToCacheAddresses, '0.5');

          // Add contract with balance less than minBid
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: hre.ethers.parseEther('0.2') }
          );

          // Check upkeep - should still be true because checkUpkeep doesn't check balance
          const { upkeepNeeded } =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.true;
        });
      });

      describe('performUpkeep', function () {
        afterEach(async function () {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        });

        it('Should do nothing when no contracts are registered', async function () {
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            checkUpkeep.performData
          );
          // No revert expected, but also no bids placed
        });

        it('Should place bid when minBid < maxBid and contract is not cached', async function () {
          // Setup: Add contract with higher maxBid than existing cache entries
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const [user] = await hre.ethers.getSigners();
          const maxBid = hre.ethers.parseEther('0.3');
          const biddingFunds = hre.ethers.parseEther('1');

          // Fill cache with some contracts at lower bid values
          const contractsToFill = dummyContracts
            .slice(1, 4)
            .map((contract) => hre.ethers.getAddress(contract));
          await fillCacheWithBids(contractsToFill, '0.2');

          // Register contract for user
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Get initial balance
          const initialBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          const minBid = await getMinBid(contractToCacheAddress);

          // Verify bid is placed
          await expect(
            cmaDeployment.cacheManagerAutomation.performUpkeep(
              checkUpkeep.performData
            )
          ).to.emit(cmaDeployment.cacheManagerAutomation, 'BidPlaced');
          // Verify results
          const finalBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();
          const isCachedAfter = await isContractCached(contractToCacheAddress);

          expect(finalBalance).to.be.lt(initialBalance);
          expect(isCachedAfter).to.be.true;
        });

        it('Should not place bid when minBid < maxBid and contract is cached', async function () {
          // Setup: Add contract and fill cache with higher bids
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          // Register contract for user
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Fill cache with higher bids
          const contractsToFill = dummyContracts
            .slice(1, 4)
            .map((contract) => hre.ethers.getAddress(contract));
          await fillCacheWithBids(contractsToFill, '0.2');

          // Get initial balance
          const initialBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            checkUpkeep.performData
          );

          // Verify balance remained unchanged
          const finalBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();
          expect(finalBalance).to.equal(initialBalance);
        });

        it('Should skip disabled contracts', async function () {
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          // Register contract for user and initially disable it
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            false, // disabled from the start
            { value: biddingFunds }
          );

          // Get initial balance
          const initialBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');

          // Since contract is disabled, upkeepNeeded should be false
          expect(checkUpkeep.upkeepNeeded).to.be.false;

          // Even if we force performUpkeep, no bids should be placed
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            checkUpkeep.performData
          );

          // Verify balance remained unchanged
          const finalBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();
          expect(finalBalance).to.equal(initialBalance);
        });

        it('Should handle multiple contracts from the same user correctly', async function () {
          this.timeout(0);
          // pre-setup: fill cache with bids
          await fillCacheWithBids(dummyContracts.slice(0, 2), '0.1');

          // Setup: Add multiple contracts for the same user
          const contractAddresses = dummyContracts
            .slice(2, 4)
            .map((contract) => hre.ethers.getAddress(contract));
          const maxBid = hre.ethers.parseEther('0.3');
          const biddingFunds = hre.ethers.parseEther('0.3');

          // Register multiple contracts for the same user
          for (const contractAddress of contractAddresses) {
            await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
              contractAddress,
              maxBid,
              true,
              { value: biddingFunds }
            );
          }

          // Verify none of the contracts are cached before upkeep
          for (const contractAddress of contractAddresses) {
            const isCachedBefore = await isContractCached(contractAddress);
            expect(isCachedBefore).to.be.false;
          }

          // Get initial balance
          const initialBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Check minimum bids for each contract
          for (const contractAddress of contractAddresses) {
            const minBid = await getMinBid(contractAddress);
            // Ensure min bid is less than max bid
            expect(minBid).to.be.lt(maxBid);
          }

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          expect(checkUpkeep.upkeepNeeded).to.be.true;

          await expect(
            cmaDeployment.cacheManagerAutomation.performUpkeep(
              checkUpkeep.performData
            )
          ).to.emit(cmaDeployment.cacheManagerAutomation, 'UpkeepPerformed');

          // Verify results
          const finalBalance =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Check if any contracts were cached
          let cachedCount = 0;
          for (const contractAddress of contractAddresses) {
            const isCached = await isContractCached(contractAddress);
            if (isCached) cachedCount++;
          }

          // Only assert balance decreased if contracts were actually cached
          if (cachedCount > 0) {
            expect(finalBalance).to.be.lt(initialBalance);
          }

          // At least one contract should be cached
          expect(cachedCount).to.be.gt(0);
        });

        it('Should handle partial success when some bids succeed and others fail', async function () {
          // Setup: Add multiple contracts with varying bid requirements
          const lowBidContract = hre.ethers.getAddress(dummyContracts[0]);
          const highBidContract = hre.ethers.getAddress(dummyContracts[1]);

          // Fill cache with some contracts to establish a minimum bid
          const contractsToFill = dummyContracts
            .slice(2, 4)
            .map((contract) => hre.ethers.getAddress(contract));
          await fillCacheWithBids(contractsToFill, '0.1');

          // Add a contract with sufficient funds
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            lowBidContract,
            hre.ethers.parseEther('0.3'),
            true,
            { value: hre.ethers.parseEther('0.15') }
          );

          // Add a contract with insufficient funds (assuming minBid will be higher than balance)
          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            highBidContract,
            hre.ethers.parseEther('1.0'),
            true,
            { value: hre.ethers.parseEther('0') }
          );

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');

          expect(
            await cmaDeployment.cacheManagerAutomation.performUpkeep(
              checkUpkeep.performData
            )
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'MinBidCheck')
            .to.emit(cmaDeployment.cacheManagerAutomation, 'BidPlaced')
            .to.emit(cmaDeployment.cacheManagerAutomation, 'MinBidCheck');

          // Verify: First contract should be cached, second should not
          const isLowBidCached = await isContractCached(lowBidContract);
          const isHighBidCached = await isContractCached(highBidContract);

          expect(isLowBidCached).to.be.true;
          expect(isHighBidCached).to.be.false;
        });

        it('Should update lastBid value after successful bid', async function () {
          // Setup: Add a contract
          const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
          const maxBid = hre.ethers.parseEther('0.3');
          const biddingFunds = hre.ethers.parseEther('1');

          await insertContract(contractAddress, maxBid, biddingFunds);

          // Get initial contract config
          const initialContracts =
            await cmaDeployment.cacheManagerAutomation.getUserContracts(
              user1.address
            );
          const initialContract = initialContracts.find(
            (c) => c.contractAddress === contractAddress
          );
          expect(initialContract?.lastBid).to.equal(hre.ethers.MaxUint256); // Default value

          // Perform upkeep
          const checkUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            checkUpkeep.performData
          );

          // Get updated contract config
          const updatedContracts =
            await cmaDeployment.cacheManagerAutomation.getUserContracts(
              await cmaDeployment.owner.getAddress()
            );
          const updatedContract = updatedContracts.find(
            (c) => c.contractAddress === contractAddress
          );

          // Verify lastBid was updated and is no longer MaxUint256
          expect(updatedContract?.lastBid).to.not.equal(hre.ethers.MaxUint256);
          expect(updatedContract?.lastBid).to.be.lt(hre.ethers.MaxUint256);
        });

        it('Should not place bid again if contract is already cached', async function () {
          // Setup: Add a contract and cache it
          const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
          const maxBid = hre.ethers.parseEther('0.3');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // First upkeep to cache the contract
          const firstCheckUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            firstCheckUpkeep.performData
          );

          // Get balance after first upkeep
          const balanceAfterFirstUpkeep =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();

          // Second upkeep should not place any bids
          const secondCheckUpkeep =
            await cmaDeployment.cacheManagerAutomation.checkUpkeep('0x');

          // If no contracts need upkeep, the upkeepNeeded flag should be false
          expect(secondCheckUpkeep.upkeepNeeded).to.be.false;

          // Even if we force performUpkeep, no bids should be placed
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            firstCheckUpkeep.performData
          );

          // Balance should remain unchanged after second upkeep
          const balanceAfterSecondUpkeep =
            await cmaDeployment.cacheManagerAutomation.getUserBalance();
          expect(balanceAfterSecondUpkeep).to.equal(balanceAfterFirstUpkeep);
        });

        it('Should respect the totalContracts limit in performData', async function () {
          // Setup: Add more contracts than will be processed in one upkeep
          const contractCount = 5;
          const contractAddresses = dummyContracts
            .slice(0, contractCount)
            .map((contract) => hre.ethers.getAddress(contract));
          const maxBid = hre.ethers.parseEther('0.3');
          const biddingFunds = hre.ethers.parseEther('1');

          // Register multiple contracts
          for (const contractAddress of contractAddresses) {
            await cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
              contractAddress,
              maxBid,
              true,
              { value: biddingFunds / BigInt(contractAddresses.length) }
            );
          }

          // Manually create performData with a smaller number of contracts to process
          const limitedContractsToProcess = 2;
          const limitedPerformData =
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
              ['uint256'],
              [limitedContractsToProcess]
            );

          // Perform upkeep with limited performData
          await cmaDeployment.cacheManagerAutomation.performUpkeep(
            limitedPerformData
          );

          // Count how many contracts were actually cached
          let cachedCount = 0;
          for (const contractAddress of contractAddresses) {
            if (await isContractCached(contractAddress)) {
              cachedCount++;
            }
          }

          // Verify only the limited number of contracts were processed
          expect(cachedCount).to.equal(limitedContractsToProcess);
        });
      });
    });
  });

  describe('Emergency Functions', function () {
    describe('Pause/Unpause', function () {
      it('Should allow owner to pause and unpause the contract', async function () {
        // Pause the contract
        await cmaDeployment.cacheManagerAutomation
          .connect(cmaDeployment.owner)
          .pause();
        expect(await cmaDeployment.cacheManagerAutomation.paused()).to.be.true;

        // Unpause the contract
        await cmaDeployment.cacheManagerAutomation
          .connect(cmaDeployment.owner)
          .unpause();
        expect(await cmaDeployment.cacheManagerAutomation.paused()).to.be.false;
      });

      it('Should prevent non-owners from pausing the contract', async function () {
        const [_, nonOwner] = await hre.ethers.getSigners();

        await expect(
          cmaDeployment.cacheManagerAutomation.connect(nonOwner).pause()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('Should prevent operations when paused', async function () {
        // Pause the contract
        await cmaDeployment.cacheManagerAutomation
          .connect(cmaDeployment.owner)
          .pause();

        // Try to perform operations
        const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.001');

        await expect(
          cmaDeployment.cacheManagerAutomation.insertOrUpdateContract(
            contractAddress,
            maxBid,
            true,
            { value: hre.ethers.parseEther('0.01') }
          )
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'ContractPaused'
        );

        await expect(
          cmaDeployment.cacheManagerAutomation.fundBalance({
            value: hre.ethers.parseEther('0.01'),
          })
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'ContractPaused'
        );

        // Unpause for other tests
        await cmaDeployment.cacheManagerAutomation
          .connect(cmaDeployment.owner)
          .unpause();
      });
    });

    describe('Emergency Withdraw', function () {
      it('Should allow owner to emergency withdraw funds', async function () {
        // Fund the contract
        const fundAmount = hre.ethers.parseEther('1.0');
        await cmaDeployment.cacheManagerAutomation.fundBalance({
          value: fundAmount,
        });

        // Check owner's balance before emergency withdraw
        const ownerBalanceBefore = await hre.ethers.provider.getBalance(
          await cmaDeployment.owner.getAddress()
        );

        // Perform emergency withdraw
        const tx = await cmaDeployment.cacheManagerAutomation
          .connect(cmaDeployment.owner)
          .emergencyWithdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt ? receipt.gasUsed * receipt.gasPrice : 0n;

        // Check owner's balance after emergency withdraw
        const ownerBalanceAfter = await hre.ethers.provider.getBalance(
          await cmaDeployment.owner.getAddress()
        );

        // Verify owner's balance increased by the expected amount (accounting for gas)
        expect(ownerBalanceAfter).to.be.closeTo(
          ownerBalanceBefore + fundAmount - gasUsed,
          hre.ethers.parseEther('0.0001') // Allow for small rounding differences
        );
      });

      it('Should prevent non-owners from emergency withdrawing', async function () {
        const [_, nonOwner] = await hre.ethers.getSigners();

        await expect(
          cmaDeployment.cacheManagerAutomation
            .connect(nonOwner)
            .emergencyWithdraw()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('Edge Cases', function () {
    it('Should handle removing a non-existent contract', async function () {
      const nonExistentContract = hre.ethers.Wallet.createRandom().address;

      await expect(
        cmaDeployment.cacheManagerAutomation.removeContract(nonExistentContract)
      ).to.be.revertedWithCustomError(
        cmaDeployment.cacheManagerAutomation,
        'ContractNotFound'
      );
    });

    it('Should handle removing all contracts when none exist', async function () {
      await expect(
        cmaDeployment.cacheManagerAutomation.removeAllContracts()
      ).to.be.revertedWithCustomError(
        cmaDeployment.cacheManagerAutomation,
        'ContractNotFound'
      );
    });

    it('Should handle receiving ETH directly', async function () {
      const [sender] = await hre.ethers.getSigners();
      const amount = hre.ethers.parseEther('0.1');

      // Send ETH directly to the contract
      await sender.sendTransaction({
        to: await cmaDeployment.cacheManagerAutomation.getAddress(),
        value: amount,
      });

      // Check contract balance
      const contractBalance = await hre.ethers.provider.getBalance(
        await cmaDeployment.cacheManagerAutomation.getAddress()
      );
      expect(contractBalance).to.be.at.least(amount);
    });
  });
});
