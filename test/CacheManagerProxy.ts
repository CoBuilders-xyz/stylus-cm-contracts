import { expect } from 'chai';
import hre from 'hardhat';
import { Wallet, JsonRpcProvider, Signer } from 'ethers';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import {
  CMPDeployment,
  deployDummyWASMContracts,
  deployCMP,
  evictAll,
  setCacheSize,
  getMinBid,
  fillCacheWithBids,
  placeBidToCacheManager,
  isContractCached,
} from './helpers';
import { CacheManagerMonitor } from './scripts/monitor';

dotenv.config();

describe('CacheManagerProxy', async function () {
  // Common test variables
  let cmpDeployment: CMPDeployment;
  let dummyContracts: string[];
  let monitor: CacheManagerMonitor;

  // Test constants
  const DEFAULT_MAX_BID = hre.ethers.parseEther('0.001');
  const DEFAULT_WALLET_FUNDING = hre.ethers.parseEther('0.01');
  const DEFAULT_BID_FUNDING = hre.ethers.parseEther('0.005');

  // Helper functions for tests
  async function insertContract(
    contractAddress: string,
    maxBid = DEFAULT_MAX_BID,
    bidFunding = DEFAULT_BID_FUNDING,
    enabled = true,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || (await hre.ethers.getSigners())[0];
    return cmpDeployment.cacheManagerProxy
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
      await cmpDeployment.cacheManagerProxy.getUserContracts(userAddress);
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.not.be.undefined;
    expect(contract?.maxBid).to.equal(expectedMaxBid);
    return contract;
  }

  async function verifyContractRemoved(
    userAddress: string,
    contractAddress: string
  ) {
    const userContracts =
      await cmpDeployment.cacheManagerProxy.getUserContracts(userAddress);
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.be.undefined;
  }

  async function verifyUserInAddressList(
    userAddress: string,
    shouldExist: boolean
  ) {
    const userAddresses =
      await cmpDeployment.cacheManagerProxy.getUserAddresses();
    if (shouldExist) {
      expect(userAddresses.includes(userAddress)).to.equal(true);
    } else {
      expect(userAddresses.includes(userAddress)).to.equal(false);
    }
  }

  async function verifyUserBalance(
    userAddress: string,
    expectedBalance: bigint
  ) {
    const userBalance = await cmpDeployment.cacheManagerProxy.getUserBalance();
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
    // Deploys a new CMP for clean start. No need to remove contracts between tests.
    cmpDeployment = await deployCMP();
    // console.log(
    //   `  ProxyAddress: ${await cmpDeployment.cacheManagerProxy.getAddress()}`
    // );

    // Evict all contracts from cache for clean start.
    await evictAll();

    // Update monitor with new CMP address
    await monitor.setTestId(uuidv4());
    await monitor.setContractAddress(
      await cmpDeployment.cacheManagerProxy.getAddress()
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
        expect(await cmpDeployment.cacheManagerProxy.owner()).to.equal(
          await cmpDeployment.owner.getAddress()
        );
      });
      it('Should set the right cache manager address', async function () {
        expect(await cmpDeployment.cacheManagerProxy.cacheManager()).to.equal(
          cmpDeployment.cacheManagerAddress
        );
      });
      it('Should set the right arb wasm cache address', async function () {
        expect(await cmpDeployment.cacheManagerProxy.arbWasmCache()).to.equal(
          cmpDeployment.arbWasmCacheAddress
        );
      });
    });
    describe('Upgradable', async function () {
      it('Should be upgradable [TODO]', async function () {});
    });
  });

  describe('Contract Management', function () {
    describe('Contract Insertion', function () {
      it('Should insert a contract to CMP', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const [user] = await hre.ethers.getSigners();

        await expect(
          insertContract(
            contractToCacheAddress,
            DEFAULT_MAX_BID,
            DEFAULT_BID_FUNDING,
            true,
            user
          )
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(user.address, contractToCacheAddress, DEFAULT_MAX_BID);

        await verifyContractExists(
          user.address,
          contractToCacheAddress,
          DEFAULT_MAX_BID
        );
        await verifyUserBalance(user.address, DEFAULT_BID_FUNDING);
        await verifyUserInAddressList(user.address, true);
      });

      it('Should insert several contracts to CMP', async function () {
        const dummyContractsAmount = dummyContracts.length;
        const [user] = await hre.ethers.getSigners();
        const contractAddresses = [];
        const biddingFunds = [];

        // Add multiple contracts to CMP
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
            .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
            .withArgs(user.address, contractAddress, DEFAULT_MAX_BID);
        }

        // Ensure all contracts were added
        let userContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
        expect(userContracts.length).to.equal(dummyContractsAmount);
        const userBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();

        // Validate stored contract data
        for (let i = 0; i < dummyContractsAmount; i++) {
          expect(userContracts[i].contractAddress).to.equal(
            contractAddresses[i]
          );
          expect(userContracts[i].maxBid).to.equal(DEFAULT_MAX_BID);
        }
        expect(userBalance).to.equal(biddingFunds.reduce((a, b) => a + b));

        // Check user was added to userAddresses
        const userAddresses = await cmpDeployment.cacheManagerProxy
          .connect(user)
          .getUserAddresses();
        expect(userAddresses.includes(user.address)).to.equal(true);
      });

      it('Should insert several contracts from diff wallets to CMP', async function () {
        const dummyContractsAmount = dummyContracts.length;
        const [mainWallet] = await hre.ethers.getSigners();
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
            .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
            .withArgs(
              extraWallets[i].address,
              contractAddress,
              DEFAULT_MAX_BID
            );
        }

        // Ensure all contracts were added correctly for each wallet
        for (let i = 0; i < dummyContractsAmount; i++) {
          const userContracts =
            await cmpDeployment.cacheManagerProxy.getUserContracts(
              extraWallets[i].address
            );
          const userBalance = await cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .getUserBalance();

          expect(userContracts.length).to.equal(1);
          expect(userContracts[0].contractAddress).to.equal(
            contractAddresses[i]
          );
          expect(userContracts[0].maxBid).to.equal(DEFAULT_MAX_BID);
          expect(userBalance).to.equal(biddingFunds[i]);

          // Check user was added to userAddresses
          const userAddresses = await cmpDeployment.cacheManagerProxy
            .connect(mainWallet)
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
      it('Should remove a contract from CMP', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const [user] = await hre.ethers.getSigners();

        // Add contract first
        await insertContract(contractToCacheAddress);

        // Remove the contract and check event emission
        await expect(
          cmpDeployment.cacheManagerProxy.removeContract(contractToCacheAddress)
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(user.address, contractToCacheAddress);

        await verifyContractRemoved(user.address, contractToCacheAddress);
        await verifyUserInAddressList(user.address, false);
        await verifyUserBalance(user.address, DEFAULT_BID_FUNDING);
      });
      it('Should remove all contracts from CMP', async function () {
        const dummyContractsAmount = 3; // Use just 3 contracts for simplicity
        const [user] = await hre.ethers.getSigners();
        const contractAddresses = [];
        const totalFunding = DEFAULT_BID_FUNDING * BigInt(dummyContractsAmount);

        // Add multiple contracts to CMP
        for (let i = 0; i < dummyContractsAmount; i++) {
          const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
          contractAddresses.push(contractAddress);
          await insertContract(contractAddress);
        }

        // Remove all contracts and check for event emissions
        await expect(cmpDeployment.cacheManagerProxy.removeAllContracts())
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[0]) // Checks the first contract removed
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[1]) // Checks the second contract removed
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[2]); // Checks the third contract removed

        // Ensure all contracts were removed
        await verifyContractRemoved(user.address, contractAddresses[0]);
        await verifyContractRemoved(user.address, contractAddresses[1]);
        await verifyContractRemoved(user.address, contractAddresses[2]);
        await verifyUserInAddressList(user.address, false);

        // User balance should be the sum of all bids
        await verifyUserBalance(user.address, totalFunding);
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
            cmpDeployment.cacheManagerProxy
              .connect(extraWallets[i])
              .removeContract(contractAddresses[i])
          )
            .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
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
        const [user] = await hre.ethers.getSigners();
        const initialMaxBid = hre.ethers.parseEther('0.001');
        const updatedMaxBid = hre.ethers.parseEther('0.005');
        const bidFunding = hre.ethers.parseEther('0.01');

        // First insert the contract
        await insertContract(
          contractToCacheAddress,
          initialMaxBid,
          bidFunding,
          true,
          user
        );

        // Verify initial state
        await verifyContractExists(
          user.address,
          contractToCacheAddress,
          initialMaxBid
        );

        // Update the max bid
        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(user)
            .insertOrUpdateContract(contractToCacheAddress, updatedMaxBid, true)
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractUpdated')
          .withArgs(user.address, contractToCacheAddress, updatedMaxBid);

        // Verify the contract was updated
        await verifyContractExists(
          user.address,
          contractToCacheAddress,
          updatedMaxBid
        );
        await verifyUserBalance(user.address, bidFunding);
        await verifyUserInAddressList(user.address, true);
      });

      it('Should update a contract max bid with additional funds', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const [user] = await hre.ethers.getSigners();
        const initialMaxBid = hre.ethers.parseEther('0.001');
        const updatedMaxBid = hre.ethers.parseEther('0.005');
        const initialFunding = hre.ethers.parseEther('0.01');
        const additionalFunding = hre.ethers.parseEther('0.02');

        // First insert the contract
        await insertContract(
          contractToCacheAddress,
          initialMaxBid,
          initialFunding,
          true,
          user
        );

        // Update the max bid with additional funds
        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(user)
            .insertOrUpdateContract(
              contractToCacheAddress,
              updatedMaxBid,
              true,
              {
                value: additionalFunding,
              }
            )
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractUpdated')
          .withArgs(user.address, contractToCacheAddress, updatedMaxBid);

        // Verify the contract was updated
        await verifyContractExists(
          user.address,
          contractToCacheAddress,
          updatedMaxBid
        );
        await verifyUserBalance(
          user.address,
          initialFunding + additionalFunding
        );
        await verifyUserInAddressList(user.address, true);
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
            .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
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
            cmpDeployment.cacheManagerProxy
              .connect(extraWallets[i])
              .removeContract(contractAddresses[i])
          )
            .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
            .withArgs(extraWallets[i].address, contractAddresses[i]);

          // Verify contract was removed correctly
          await verifyContractRemoved(
            extraWallets[i].address,
            contractAddresses[i]
          );
          await verifyUserInAddressList(extraWallets[i].address, false);

          // Check balance using the correct wallet connection
          const userBalance = await cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .getUserBalance();
          expect(userBalance).to.equal(biddingFunds);
        }

        // Final verification that all users have been removed from the address list
        const userAddresses =
          await cmpDeployment.cacheManagerProxy.getUserAddresses();
        expect(userAddresses.length).to.equal(0);
      });
    });
    describe('Contract Enabling/Disabling', function () {
      it('Should allow enabling and disabling contracts', async function () {
        const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.001');
        const bidFunding = hre.ethers.parseEther('0.01');

        // Add contract as enabled
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractAddress,
          maxBid,
          true,
          { value: bidFunding }
        );

        // Disable the contract
        await cmpDeployment.cacheManagerProxy.setContractEnabled(
          contractAddress,
          false
        );

        // Verify contract is disabled
        const userContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(
            await cmpDeployment.owner.getAddress()
          );
        const contract = userContracts.find(
          (c) => c.contractAddress === contractAddress
        );
        expect(contract?.enabled).to.be.false;

        // Re-enable the contract
        await cmpDeployment.cacheManagerProxy.setContractEnabled(
          contractAddress,
          true
        );

        // Verify contract is enabled again
        const updatedContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(
            await cmpDeployment.owner.getAddress()
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
          cmpDeployment.cacheManagerProxy.fundBalance({ value: fundAmount })
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'BalanceUpdated')
          .withArgs(user.address, fundAmount);

        const userBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        expect(userBalance).to.equal(fundAmount);
      });

      it('Should revert when funding with less than MIN_BID_AMOUNT', async function () {
        await expect(
          cmpDeployment.cacheManagerProxy.fundBalance({ value: 0 })
        ).to.be.revertedWithCustomError(
          cmpDeployment.cacheManagerProxy,
          'InvalidBid'
        );
      });

      it('Should accumulate balance when funding multiple times', async function () {
        const fundAmount1 = hre.ethers.parseEther('0.1');
        const fundAmount2 = hre.ethers.parseEther('0.2');

        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundAmount1,
        });
        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundAmount2,
        });

        const userBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        expect(userBalance).to.equal(fundAmount1 + fundAmount2);
      });
    });

    describe('Withdraw Balance', function () {
      it('Should allow users to withdraw their balance', async function () {
        const [user] = await hre.ethers.getSigners();
        const fundAmount = hre.ethers.parseEther('0.5');

        // Fund the balance first
        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundAmount,
        });

        // Check user's ETH balance before withdrawal
        const balanceBefore = await hre.ethers.provider.getBalance(
          user.address
        );

        // Withdraw and track gas costs
        const tx = await cmpDeployment.cacheManagerProxy.withdrawBalance();
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
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        expect(userBalance).to.equal(0);
      });

      it('Should revert when withdrawing with zero balance', async function () {
        await expect(
          cmpDeployment.cacheManagerProxy.withdrawBalance()
        ).to.be.revertedWithCustomError(
          cmpDeployment.cacheManagerProxy,
          'InsufficientBalance'
        );
      });

      it('Should emit BalanceUpdated event when withdrawing', async function () {
        const fundAmount = hre.ethers.parseEther('0.5');
        const [user] = await hre.ethers.getSigners();

        // Fund the balance first
        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundAmount,
        });

        // Withdraw and check for event
        await expect(cmpDeployment.cacheManagerProxy.withdrawBalance())
          .to.emit(cmpDeployment.cacheManagerProxy, 'BalanceUpdated')
          .withArgs(user.address, 0);
      });
    });
  });

  describe('Bidding Mechanism', function () {
    describe('Placing Bids From Proxy', function () {
      // Just for testing. Place bid function wont be available for the public.
      it('Should fund the proxy and place a bid', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const [user] = await hre.ethers.getSigners();
        const bidAmount = hre.ethers.parseEther('0.1');
        const fundingAmount = hre.ethers.parseEther('0.5');

        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundingAmount,
        });

        await expect(
          cmpDeployment.cacheManagerProxy.placeBidExternal(
            contractToCacheAddress,
            bidAmount
          )
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'BidPlaced')
          .withArgs(user.address, contractToCacheAddress, bidAmount);
      });
    });
    describe('Automation', function () {
      describe('checkUpkeep', function () {
        it('Should return upkeepNeeded=false when no contracts are registered', async function () {
          const { upkeepNeeded } =
            await cmpDeployment.cacheManagerProxy.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=false when minBid exceeds maxBid', async function () {
          // Setup: Add contract with maxBid of 0.1 ETH
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
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
            await cmpDeployment.cacheManagerProxy.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });

        it('Should return upkeepNeeded=true when minBid < maxBid and contract is not cached', async function () {
          // Setup: Add contract with sufficient maxBid
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Check upkeep
          const { upkeepNeeded } =
            await cmpDeployment.cacheManagerProxy.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.true;
        });

        it('Should return upkeepNeeded=false when minBid < maxBid and contract is cached', async function () {
          // Setup: Add contract and cache it
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
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
            await cmpDeployment.cacheManagerProxy.checkUpkeep('0x');
          expect(upkeepNeeded).to.be.false;
        });
      });

      describe('performUpkeep', function () {
        it('Should do nothing when no contracts are registered', async function () {
          const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
            '0x'
          );
          await cmpDeployment.cacheManagerProxy.performUpkeep(
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
          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Get initial balance
          const initialBalance =
            await cmpDeployment.cacheManagerProxy.getUserBalance();

          // Perform upkeep
          const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
            '0x'
          );
          const minBid = await getMinBid(contractToCacheAddress);

          // Verify bid is placed
          await expect(
            cmpDeployment.cacheManagerProxy.performUpkeep(
              checkUpkeep.performData
            )
          )
            .to.emit(cmpDeployment.cacheManagerProxy, 'BidPlaced')
            .withArgs(user.address, contractToCacheAddress, minBid);

          // Verify results
          const finalBalance =
            await cmpDeployment.cacheManagerProxy.getUserBalance();
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
          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
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
            await cmpDeployment.cacheManagerProxy.getUserBalance();

          // Perform upkeep
          const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
            '0x'
          );
          await cmpDeployment.cacheManagerProxy.performUpkeep(
            checkUpkeep.performData
          );

          // Verify balance remained unchanged
          const finalBalance =
            await cmpDeployment.cacheManagerProxy.getUserBalance();
          expect(finalBalance).to.equal(initialBalance);
        });

        it('Should skip disabled contracts', async function () {
          const contractToCacheAddress = hre.ethers.getAddress(
            dummyContracts[0]
          );
          const maxBid = hre.ethers.parseEther('0.1');
          const biddingFunds = hre.ethers.parseEther('1');

          // Register contract for user
          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            true,
            { value: biddingFunds }
          );

          // Get initial balance
          const initialBalance =
            await cmpDeployment.cacheManagerProxy.getUserBalance();

          // Disable the contract
          await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractToCacheAddress,
            maxBid,
            false
          );

          // Perform upkeep
          const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
            '0x'
          );
          await cmpDeployment.cacheManagerProxy.performUpkeep(
            checkUpkeep.performData
          );

          // Verify balance remained unchanged
          const finalBalance =
            await cmpDeployment.cacheManagerProxy.getUserBalance();
          expect(finalBalance).to.equal(initialBalance);
        });
      });
    });
  });

  describe('Emergency Functions', function () {
    describe('Pause/Unpause', function () {
      it('Should allow owner to pause and unpause the contract', async function () {
        // Pause the contract
        await cmpDeployment.cacheManagerProxy
          .connect(cmpDeployment.owner)
          .pause();
        expect(await cmpDeployment.cacheManagerProxy.paused()).to.be.true;

        // Unpause the contract
        await cmpDeployment.cacheManagerProxy
          .connect(cmpDeployment.owner)
          .unpause();
        expect(await cmpDeployment.cacheManagerProxy.paused()).to.be.false;
      });

      it('Should prevent non-owners from pausing the contract', async function () {
        const [_, nonOwner] = await hre.ethers.getSigners();

        await expect(
          cmpDeployment.cacheManagerProxy.connect(nonOwner).pause()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('Should prevent operations when paused', async function () {
        // Pause the contract
        await cmpDeployment.cacheManagerProxy
          .connect(cmpDeployment.owner)
          .pause();

        // Try to perform operations
        const contractAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.001');

        await expect(
          cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractAddress,
            maxBid,
            true,
            { value: hre.ethers.parseEther('0.01') }
          )
        ).to.be.revertedWithCustomError(
          cmpDeployment.cacheManagerProxy,
          'ContractPaused'
        );

        await expect(
          cmpDeployment.cacheManagerProxy.fundBalance({
            value: hre.ethers.parseEther('0.01'),
          })
        ).to.be.revertedWithCustomError(
          cmpDeployment.cacheManagerProxy,
          'ContractPaused'
        );

        // Unpause for other tests
        await cmpDeployment.cacheManagerProxy
          .connect(cmpDeployment.owner)
          .unpause();
      });
    });

    describe('Emergency Withdraw', function () {
      it('Should allow owner to emergency withdraw funds', async function () {
        // Fund the contract
        const fundAmount = hre.ethers.parseEther('1.0');
        await cmpDeployment.cacheManagerProxy.fundBalance({
          value: fundAmount,
        });

        // Check owner's balance before emergency withdraw
        const ownerBalanceBefore = await hre.ethers.provider.getBalance(
          await cmpDeployment.owner.getAddress()
        );

        // Perform emergency withdraw
        const tx = await cmpDeployment.cacheManagerProxy
          .connect(cmpDeployment.owner)
          .emergencyWithdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt ? receipt.gasUsed * receipt.gasPrice : 0n;

        // Check owner's balance after emergency withdraw
        const ownerBalanceAfter = await hre.ethers.provider.getBalance(
          await cmpDeployment.owner.getAddress()
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
          cmpDeployment.cacheManagerProxy.connect(nonOwner).emergencyWithdraw()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('Edge Cases', function () {
    it('Should handle removing a non-existent contract', async function () {
      const nonExistentContract = hre.ethers.Wallet.createRandom().address;

      await expect(
        cmpDeployment.cacheManagerProxy.removeContract(nonExistentContract)
      ).to.be.revertedWithCustomError(
        cmpDeployment.cacheManagerProxy,
        'ContractNotFound'
      );
    });

    it('Should handle removing all contracts when none exist', async function () {
      await expect(
        cmpDeployment.cacheManagerProxy.removeAllContracts()
      ).to.be.revertedWithCustomError(
        cmpDeployment.cacheManagerProxy,
        'ContractNotFound'
      );
    });

    it('Should handle receiving ETH directly', async function () {
      const [sender] = await hre.ethers.getSigners();
      const amount = hre.ethers.parseEther('0.1');

      // Send ETH directly to the contract
      await sender.sendTransaction({
        to: await cmpDeployment.cacheManagerProxy.getAddress(),
        value: amount,
      });

      // Check contract balance
      const contractBalance = await hre.ethers.provider.getBalance(
        await cmpDeployment.cacheManagerProxy.getAddress()
      );
      expect(contractBalance).to.be.at.least(amount);
    });
  });
});
