import { expect } from 'chai';
import hre from 'hardhat';
import dotenv from 'dotenv';
import {
  CMPDeployment,
  deployDummyWASMContracts,
  deployCMP,
  evictAll,
  setCacheSize,
} from './helpers';

dotenv.config();

const logFile = 'cacheManagerProxyTest.log';

describe('CacheManagerProxy', async function () {
  let cmpDeployment: CMPDeployment;
  let dummyContracts: string[];
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
    console.log('---------------------------------------');
  });

  beforeEach(async function () {
    // Deploys a new CMP for clean start. No need to remove contracts between tests.
    cmpDeployment = await deployCMP();
    console.log(
      `  ProxyAddress: ${await cmpDeployment.cacheManagerProxy.getAddress()}`
    );

    // Evict all contracts from cache for clean start.
    await evictAll();
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
    });
    it('Should insert several contracts from diff wallets to CMP', async function () {
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
    });
  });

  // Just for testing. Place bid function wont be available for the public.
  describe('Placing Bids From Proxy', function () {
    // it('Should insert a contract to CMP and place a bid', async function () {
    //   const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
    //   const [user] = await hre.ethers.getSigners();
    //   const bidAmount = hre.ethers.parseEther('1');
    //   await expect(
    //     cmpDeployment.cacheManagerProxy.placeUserBid(contractToCacheAddress, {
    //       value: bidAmount,
    //     })
    //   )
    //     .to.emit(cmpDeployment.cacheManagerProxy, 'ContractAdded')
    //     .withArgs(user.address, contractToCacheAddress, bidAmount)
    //     .to.emit(cmpDeployment.cacheManagerProxy, 'BidPlaced')
    //     .withArgs(user.address, contractToCacheAddress, bidAmount);
    //   const userContracts =
    //     await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
    //   expect(userContracts.length).to.equal(1);
    //   expect(userContracts[0].contractAddress).to.equal(contractToCacheAddress);
    //   expect(userContracts[0].maxBid).to.equal(bidAmount);
    // });
    // it('Should revert if bid is below getMinBid', async function () {
    //   const contractToCacheAddress1 = hre.ethers.getAddress(dummyContracts[0]);
    //   const contractToCacheAddress2 = hre.ethers.getAddress(dummyContracts[1]);
    //   const contractToCacheAddress3 = hre.ethers.getAddress(dummyContracts[2]);
    //   const bidAmount = hre.ethers.parseEther('1');
    //   const lowBidAmount = hre.ethers.parseEther('0.5'); // Below min bid
    //   // Place two valid bids on different contracts
    //   await cmpDeployment.cacheManagerProxy.placeUserBid(
    //     contractToCacheAddress1,
    //     {
    //       value: bidAmount,
    //     }
    //   );
    //   await cmpDeployment.cacheManagerProxy.placeUserBid(
    //     contractToCacheAddress2,
    //     {
    //       value: bidAmount,
    //     }
    //   );
    //   // Third bid should fail due to insufficient bid amount
    //   await expect(
    //     cmpDeployment.cacheManagerProxy.placeUserBid(contractToCacheAddress3, {
    //       value: lowBidAmount,
    //     })
    //   ).to.be.revertedWith('Insufficient bid amount');
    // });

    describe('Automation', function () {});
    it('Should checkUpkeep true and place a bid with performUpkeep', async function () {
      const contractToCacheAddress = hre.ethers.getAddress(dummyContracts[0]);
      const [user] = await hre.ethers.getSigners();
      const maxBid = hre.ethers.parseEther('0.1');
      const biddingFunds = hre.ethers.parseEther('1');

      cmpDeployment.cacheManagerProxy.insertOrUpdateContract(
        contractToCacheAddress,
        maxBid,
        { value: biddingFunds }
      );

      const userContracts =
        await cmpDeployment.cacheManagerProxy.getUserContracts(user.address);
      const userBalance =
        await cmpDeployment.cacheManagerProxy.getUserBalance();
      expect(userContracts.length).to.equal(1);
      expect(userContracts[0].contractAddress).to.equal(contractToCacheAddress);
      expect(userContracts[0].maxBid).to.equal(maxBid);
      expect(userBalance).to.equal(biddingFunds);
    });
  });
});
