import { expect } from 'chai';
import hre from 'hardhat';
import { Wallet, JsonRpcProvider } from 'ethers';
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
  let cmpDeployment: CMPDeployment;
  let dummyContracts: string[];
  let monitor: CacheManagerMonitor;
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

  afterEach(async () => {
    // Add small delay to allow events to be processed
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await monitor.stopMonitoring();
  });

  describe('Deployment', async function () {
    it('Should set the right owner', async function () {
      expect(await cmpDeployment.cacheManagerProxy.owner()).to.equal(
        await cmpDeployment.owner.getAddress()
      );
    });
  });

  describe('Insert/ Update / Remove Contracts', function () {
    it('Should insert a contract to CMP', async function () {
      const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
      const [user] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const biddingFunds = hre.ethers.parseEther('1');

      await expect(
        cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        )
      )
        .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
        .withArgs(user.address, contractToCacheAddress, maxBid);

      const userContracts =
        await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
      const userBalance =
        await cmpDeployment.cacheManagerProxy.getUserBalance();
      expect(userContracts.length).to.equal(1);
      expect(userContracts[0].contractAddress).to.equal(contractToCacheAddress);
      expect(userContracts[0].maxBid).to.equal(maxBid);
      expect(userBalance).to.equal(biddingFunds);

      // Check user was added to userAddresses
      // OnlyOwner function
      const userAddresses = await cmpDeployment.cacheManagerProxy
        .connect(user)
        .getUserAddresses();
      expect(userAddresses.includes(user.address)).to.equal(true);
    });
    it('Should insert several contracts to CMP', async function () {
      const dummyContractsAmount = dummyContracts.length;
      const [user] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const contractAddresses = [];
      const biddingFunds = [];

      // Add multiple contracts to CMP
      for (let i = 0; i < dummyContractsAmount; i++) {
        const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
        contractAddresses.push(contractAddress);
        biddingFunds.push(
          BigInt(Math.floor(Math.random() * Number(maxBid))) + 2n * maxBid
        );

        await expect(
          cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractAddress,
            maxBid,
            { value: biddingFunds[i] }
          )
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(user.address, contractAddress, maxBid);
      }

      // Ensure all contracts were added
      let userContracts =
        await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
      expect(userContracts.length).to.equal(dummyContractsAmount);
      const userBalance =
        await cmpDeployment.cacheManagerProxy.getUserBalance();

      // Validate stored contract data
      for (let i = 0; i < dummyContractsAmount; i++) {
        expect(userContracts[i].contractAddress).to.equal(contractAddresses[i]);
        expect(userContracts[i].maxBid).to.equal(maxBid);
      }
      expect(userBalance).to.equal(biddingFunds.reduce((a, b) => a + b));

      // Check user was added to userAddresses
      // OnlyOwner function
      const userAddresses = await cmpDeployment.cacheManagerProxy
        .connect(user)
        .getUserAddresses();
      expect(userAddresses.includes(user.address)).to.equal(true);
    });
    it('Should insert several contracts from diff wallets to CMP', async function () {
      const dummyContractsAmount = dummyContracts.length;
      const [mainWallet] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const contractAddresses = [];
      const extraWallets: Wallet[] = [];
      const biddingFunds = [];

      // Generate additional wallets
      for (let i = 0; i < dummyContractsAmount; i++) {
        const wallet = new hre.ethers.Wallet(
          hre.ethers.Wallet.createRandom().privateKey,
          mainWallet.provider
        );
        extraWallets.push(wallet);

        // Fund the new wallet from the main wallet
        const tx = await mainWallet.sendTransaction({
          to: wallet.address,
          value: hre.ethers.parseEther('1'), // fund wallet
        });
        await tx.wait();
      }

      // Each wallet adds a contract
      for (let i = 0; i < dummyContractsAmount; i++) {
        const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
        contractAddresses.push(contractAddress);
        biddingFunds.push(
          BigInt(Math.floor(Math.random() * Number(maxBid))) + 2n * maxBid
        );

        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .insertOrUpdateContract(contractAddress, maxBid, {
              value: biddingFunds[i],
            })
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(extraWallets[i].address, contractAddress, maxBid);
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
        expect(userContracts[0].contractAddress).to.equal(contractAddresses[i]);
        expect(userContracts[0].maxBid).to.equal(maxBid);
        expect(userBalance).to.equal(biddingFunds[i]);

        // Check user was added to userAddresses
        // OnlyOwner function
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
    it('Should remove a contract from CMP', async function () {
      const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
      const [user] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');

      // Add contract first
      await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
        contractToCacheAddress,
        maxBid
      );

      let userContracts =
        await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
      expect(userContracts.length).to.equal(1);
      expect(userContracts[0].contractAddress).to.equal(contractToCacheAddress);

      // Remove the contract and check event emission
      await expect(
        cmpDeployment.cacheManagerProxy.removeContract(contractToCacheAddress)
      )
        .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
        .withArgs(user.address, contractToCacheAddress);

      // Check if it was removed
      userContracts = await cmpDeployment.cacheManagerProxy.getUserContracts(
        user.address
      );
      expect(userContracts.length).to.equal(0);

      // Check user with 0 contracts was removed from userAddresses list
      // OnlyOwner function
      const userAddresses =
        await cmpDeployment.cacheManagerProxy.getUserAddresses();
      expect(userAddresses.includes(user.address)).to.equal(false);
    });
    it('Should remove all contracts from CMP', async function () {
      const dummyContractsAmount = dummyContracts.length;
      const [user] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const contractAddresses = [];

      // Add multiple contracts to CMP
      for (let i = 0; i < dummyContractsAmount; i++) {
        const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
        contractAddresses.push(contractAddress);

        await expect(
          cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
            contractAddress,
            maxBid
          )
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(user.address, contractAddress, maxBid);
      }

      // Ensure all contracts were added
      let userContracts =
        await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
      expect(userContracts.length).to.equal(dummyContractsAmount);

      // Remove all contracts and check for event emissions
      await expect(cmpDeployment.cacheManagerProxy.removeAllContracts())
        .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
        .withArgs(user.address, contractAddresses[0]) // Checks the first contract removed
        .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
        .withArgs(user.address, contractAddresses[1]) // Checks the second contract removed
        .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
        .withArgs(user.address, contractAddresses[2]); // Extend this for more contracts if needed

      // Ensure all contracts were removed
      userContracts = await cmpDeployment.cacheManagerProxy.getUserContracts(
        user.address
      );
      expect(userContracts.length).to.equal(0);

      // Check user with 0 contracts was removed from userAddresses list
      // OnlyOwner function
      const userAddresses =
        await cmpDeployment.cacheManagerProxy.getUserAddresses();
      expect(userAddresses.length).to.equal(0);
    });
    it('Should remove some contracts from diff wallets while others remain', async function () {
      const dummyContractsAmount = dummyContracts.length;
      const [mainWallet] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const contractAddresses = [];
      const extraWallets = [];

      // Generate additional wallets
      for (let i = 0; i < dummyContractsAmount; i++) {
        const wallet = new hre.ethers.Wallet(
          hre.ethers.Wallet.createRandom().privateKey,
          mainWallet.provider
        );
        extraWallets.push(wallet);

        // Fund the new wallet from the main wallet
        const tx = await mainWallet.sendTransaction({
          to: wallet.address,
          value: hre.ethers.parseEther('5'), // Send 5 ETH for gas and transactions
        });
        await tx.wait();
      }

      // Each wallet adds a contract
      for (let i = 0; i < dummyContractsAmount; i++) {
        const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
        contractAddresses.push(contractAddress);

        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .insertOrUpdateContract(contractAddress, maxBid)
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(extraWallets[i].address, contractAddress, maxBid);
      }

      // Remove contracts from half of the wallets
      for (let i = 0; i < Math.floor(dummyContractsAmount / 2); i++) {
        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .removeContract(contractAddresses[i])
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(extraWallets[i].address, contractAddresses[i]);
      }

      // Validate removal for half of the wallets
      for (let i = 0; i < Math.floor(dummyContractsAmount / 2); i++) {
        const userContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(
            extraWallets[i].address
          );
        expect(userContracts.length).to.equal(0);

        const userAddresses = await cmpDeployment.cacheManagerProxy
          .connect(mainWallet)
          .getUserAddresses();
        expect(userAddresses.includes(extraWallets[i].address)).to.equal(false);
      }

      // Validate contracts still exist for the other half
      for (
        let i = Math.floor(dummyContractsAmount / 2);
        i < dummyContractsAmount;
        i++
      ) {
        const userContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(
            extraWallets[i].address
          );
        expect(userContracts.length).to.equal(1);
        expect(userContracts[0].contractAddress).to.equal(contractAddresses[i]);

        const userAddresses = await cmpDeployment.cacheManagerProxy
          .connect(mainWallet)
          .getUserAddresses();
        expect(userAddresses.includes(extraWallets[i].address)).to.equal(true);
      }
    });
    it('Should add and remove contracts from diff wallets in random order', async function () {
      const dummyContractsAmount = dummyContracts.length;

      const [mainWallet] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const contractAddresses = [];
      const extraWallets = [];
      const biddingFunds = [];

      // Generate additional wallets
      for (let i = 0; i < dummyContractsAmount; i++) {
        const wallet = new hre.ethers.Wallet(
          hre.ethers.Wallet.createRandom().privateKey,
          mainWallet.provider
        );
        extraWallets.push(wallet);

        // Fund the new wallet from the main wallet
        const tx = await mainWallet.sendTransaction({
          to: wallet.address,
          value: hre.ethers.parseEther('1'), // Send 5 ETH for gas and transactions
        });
        await tx.wait();
      }

      // Shuffle array to add contracts in random order
      const shuffledIndexes = [...Array(dummyContractsAmount).keys()].sort(
        () => Math.random() - 0.5
      );

      // Each wallet adds a contract in random order
      for (const i of shuffledIndexes) {
        const contractAddress = hre.ethers.getAddress(dummyContracts[i]);
        contractAddresses[i] = contractAddress;
        biddingFunds[i] =
          BigInt(Math.floor(Math.random() * Number(maxBid))) + 2n * maxBid;

        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .insertOrUpdateContract(contractAddress, maxBid, {
              value: biddingFunds[i],
            })
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
          .withArgs(extraWallets[i].address, contractAddress, maxBid);
      }

      // Shuffle again for random removal order
      const shuffledRemovalIndexes = [...shuffledIndexes].sort(
        () => Math.random() - 0.5
      );

      // Remove contracts randomly
      for (const i of shuffledRemovalIndexes) {
        await expect(
          cmpDeployment.cacheManagerProxy
            .connect(extraWallets[i])
            .removeContract(contractAddresses[i])
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'ContractRemoved')
          .withArgs(extraWallets[i].address, contractAddresses[i]);
      }

      // Validate all contracts were removed
      for (const wallet of extraWallets) {
        const userContracts =
          await cmpDeployment.cacheManagerProxy.getUserContracts(
            wallet.address
          );
        expect(userContracts.length).to.equal(0);
      }

      // Validate all users have their unused funds
      for (let i = 0; i < dummyContractsAmount; i++) {
        const userBalance = await cmpDeployment.cacheManagerProxy
          .connect(extraWallets[i])
          .getUserBalance();
        expect(userBalance).to.equal(biddingFunds[i]);
      }

      // Check users were removed from userAddresses list
      // OnlyOwner function
      const userAddresses =
        await cmpDeployment.cacheManagerProxy.getUserAddresses();
      expect(userAddresses.length).to.equal(0);
    });
  });

  // Just for testing. Place bid function wont be available for the public.
  describe('Placing Bids From Proxy', function () {
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
        const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
          '0x'
        );
        expect(checkUpkeep.upkeepNeeded).to.be.false;
      });

      it('Should return upkeepNeeded=false when minBid exceeds maxBid', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const contractToFillAddress = dummyContracts
          .slice(1, 4)
          .map((contract) => hre.ethers.getAddress(contract));
        const maxBid = hre.ethers.parseEther('0.1');
        const biddingFunds = hre.ethers.parseEther('1');

        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        );

        // Place a high bid to make minBid > maxBid
        await fillCacheWithBids(contractToFillAddress, '0.2'); // to make minSuggestedBid > maxBid

        const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
          '0x'
        );
        expect(checkUpkeep.upkeepNeeded).to.be.false;
      });

      it('Should return upkeepNeeded=true when minBid < maxBid and contract is not cached', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.1');
        const biddingFunds = hre.ethers.parseEther('1');
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        );
        const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
          '0x'
        );
        expect(checkUpkeep.upkeepNeeded).to.be.true;
      });

      it('Should return upkeepNeeded=false when minBid < maxBid and contract is cached', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.1');
        const biddingFunds = hre.ethers.parseEther('1');
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        );
        await placeBidToCacheManager(
          contractToCacheAddress,
          hre.ethers.parseEther('0.1')
        ); // Cache the contract before upkeep (already cached)
        const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
          '0x'
        );

        expect(checkUpkeep.upkeepNeeded).to.be.false;
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
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const [user] = await hre.ethers.getSigners();
        const contractToFillAddress = dummyContracts.slice(1, 4);
        const maxBid = hre.ethers.parseEther('0.3');
        const biddingFunds = hre.ethers.parseEther('1');

        // Add a small delay to ensure monitor is ready
        // await new Promise((resolve) => setTimeout(resolve, 1000));

        await fillCacheWithBids(contractToFillAddress, '0.2');

        // Setup contract for user
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
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
        await expect(
          cmpDeployment.cacheManagerProxy.performUpkeep(checkUpkeep.performData)
        )
          .to.emit(cmpDeployment.cacheManagerProxy, 'BidPlaced')
          .withArgs(user.address, contractToCacheAddress, minBid);

        // Verify the results
        const finalBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        const isCachedAfter = await isContractCached(contractToCacheAddress);

        expect(finalBalance).to.be.lt(initialBalance);
        expect(isCachedAfter).to.be.true;
      });

      it('Should not place bid when minBid > maxBid and contract is cached', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const contractToFillAddress = dummyContracts
          .slice(1, 4)
          .map((contract) => hre.ethers.getAddress(contract));
        const maxBid = hre.ethers.parseEther('0.1');
        const biddingFunds = hre.ethers.parseEther('1');

        // Setup contract for user
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        );

        // Place a high bid to make minBid > maxBid
        await fillCacheWithBids(contractToFillAddress, '0.2');

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

        // Check that balance remained the same
        const finalBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        expect(finalBalance).to.equal(initialBalance);
      });

      xit('Should skip disabled contracts', async function () {
        const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
        const maxBid = hre.ethers.parseEther('0.1');
        const biddingFunds = hre.ethers.parseEther('1');

        // Setup contract for user
        await cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
          contractToCacheAddress,
          maxBid,
          { value: biddingFunds }
        );

        // Get initial balance
        const initialBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();

        // Disable the contract (you'll need to add this function to the contract)
        // await cmpDeployment.cacheManagerProxy.setContractEnabled(contractToCacheAddress, false);

        // Perform upkeep
        const checkUpkeep = await cmpDeployment.cacheManagerProxy.checkUpkeep(
          '0x'
        );
        await cmpDeployment.cacheManagerProxy.performUpkeep(
          checkUpkeep.performData
        );

        // Check that balance remained the same
        const finalBalance =
          await cmpDeployment.cacheManagerProxy.getUserBalance();
        expect(finalBalance).to.equal(initialBalance);
      });
    });
  });
});
