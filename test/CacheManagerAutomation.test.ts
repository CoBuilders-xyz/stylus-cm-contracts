import { expect } from 'chai';
import hre from 'hardhat';
import { Wallet, Signer } from 'ethers';
import dotenv from 'dotenv';

import {
  CMADeployment,
  deployDummyWASMContracts,
  deployCMA,
  evictAll,
  setCacheSize,
} from './helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

dotenv.config();

describe('cacheManagerAutomation', async function () {
  // Common test variables
  let cmaDeployment: CMADeployment;
  let dummyContracts: string[];

  // Test constants
  const DEFAULT_MAX_BID = hre.ethers.parseEther('0.001');
  const DEFAULT_WALLET_FUNDING = hre.ethers.parseEther('0.01');
  const DEFAULT_BID_FUNDING = hre.ethers.parseEther('0.005');

  // Wallets
  var owner: HardhatEthersSigner;
  var user: HardhatEthersSigner;

  // Helper functions for tests
  async function insertContract(
    contractAddress: string,
    maxBid = DEFAULT_MAX_BID,
    enabled = true,
    wallet?: Wallet | Signer,
    funding?: bigint
  ) {
    const signer = wallet || user;
    return cmaDeployment.cacheManagerAutomation
      .connect(signer)
      .insertContract(contractAddress, maxBid, enabled, {
        value: funding || 0n,
      });
  }

  // Helper function to decode and display transaction logs
  function logTransactionEvents(
    receipt: any,
    showLogs: boolean = true
  ): Array<{ eventName: string; args: any }> {
    if (!receipt?.logs || receipt.logs.length === 0) {
      if (showLogs) console.log('\tNo events emitted');
      return [];
    }

    if (showLogs) {
      console.log(`\n\t📋 Transaction Events (${receipt.logs.length} total):`);
      console.log('\t' + '='.repeat(50));
    }

    // Calculate event signatures for BiddingEscrow events
    const depositedSignature = hre.ethers.id('Deposited(address,uint256)');
    const withdrawnSignature = hre.ethers.id('Withdrawn(address,uint256)');

    const events: Array<{ eventName: string; args: any }> = [];

    receipt.logs.forEach((log: any, index: number) => {
      try {
        // Try to decode with CacheManagerAutomation interface
        const parsedLog =
          cmaDeployment.cacheManagerAutomation.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });

        if (parsedLog) {
          if (showLogs) {
            console.log(`\t${index + 1}. 🎯 ${parsedLog.name}`);
            console.log(`\t   Contract: CacheManagerAutomation`);
          }
          events.push({
            eventName: parsedLog.name,
            args: parsedLog.args,
          });
          if (showLogs && parsedLog.args && parsedLog.args.length > 0) {
            console.log(
              `\t   Args: ${parsedLog.args
                .map((arg: any) =>
                  typeof arg === 'bigint'
                    ? arg
                    : typeof arg === 'string' && arg.startsWith('0x')
                    ? arg
                    : arg.toString()
                )
                .join(', ')}`
            );
          }
        }
      } catch (e1) {
        // Check for BiddingEscrow events
        const topic0 = log.topics[0];

        if (topic0 === depositedSignature) {
          if (showLogs) {
            console.log(`\t${index + 1}. 💰 Deposited`);
            console.log(`\t   Contract: BiddingEscrow`);
          }
          const payee = '0x' + log.topics[1].slice(26); // Remove padding
          const amount = log.data;
          events.push({
            eventName: 'Deposited',
            args: [payee, amount],
          });
          if (showLogs) {
            console.log(
              `\t   Args: ${payee.slice(0, 10)}..., ${hre.ethers.formatEther(
                amount
              )} ETH`
            );
          }
        } else if (topic0 === withdrawnSignature) {
          if (showLogs) {
            console.log(`\t${index + 1}. 💰 Withdrawn`);
            console.log(`\t   Contract: BiddingEscrow`);
          }
          const payee = '0x' + log.topics[1].slice(26); // Remove padding
          const amount = log.data;
          events.push({
            eventName: 'Withdrawn',
            args: [payee, amount],
          });
          if (showLogs) {
            console.log(
              `\t   Args: ${payee.slice(0, 10)}..., ${hre.ethers.formatEther(
                amount
              )} ETH`
            );
          }
        } else {
          if (showLogs) {
            console.log(`\t${index + 1}. ❓ Unknown Event`);
            console.log(`\t   Topic0: ${topic0}`);
            console.log(`\t   Contract Address: ${log.address}`);
          }
          events.push({
            eventName: 'Unknown',
            args: [topic0, log.address],
          });
        }
      }
    });

    if (showLogs) {
      console.log('\t' + '='.repeat(50));
    }

    return events;
  }

  async function createAndFundWallet(fundAmount = DEFAULT_WALLET_FUNDING) {
    const wallet = new hre.ethers.Wallet(
      hre.ethers.Wallet.createRandom().privateKey,
      owner.provider
    );

    // Fund the new wallet from the main wallet
    const tx = await owner.sendTransaction({
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
    contractAddress: string,
    expectedMaxBid: bigint,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || user;
    const userContracts = await cmaDeployment.cacheManagerAutomation
      .connect(signer)
      .getUserContracts();
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.not.be.undefined;
    expect(contract?.contractAddress).to.equal(contractAddress);
    expect(contract?.maxBid).to.equal(expectedMaxBid);
    return contract;
  }

  async function verifyContractRemoved(
    contractAddress: string,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || user;
    const userContracts = await cmaDeployment.cacheManagerAutomation
      .connect(signer)
      .getUserContracts();
    const contract = userContracts.find(
      (c) => c.contractAddress === contractAddress
    );
    expect(contract).to.be.undefined;
  }

  async function verifyUserBalance(
    expectedBalance: bigint,
    wallet?: Wallet | Signer
  ) {
    const signer = wallet || user;
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
    await setCacheSize();

    // Setup signers
    owner = (await hre.ethers.getSigners())[0];
    user = (await hre.ethers.getSigners())[1];

    // Fund user with 100 ETH
    const tx = await owner.sendTransaction({
      to: user.address,
      value: hre.ethers.parseEther('100'),
    });
    await tx.wait();

    // Check owner and user balances
    const ownerBalance = hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(owner.address)
    );
    const userBalance = hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(user.address)
    );

    cmaDeployment = await deployCMA();

    console.log('---------------------------------------');
    console.log('Addresses and Balances');
    console.log('----------------------');
    console.log(`  Owner: ${owner.address} - ${ownerBalance} ETH`);
    console.log(`  User: ${user.address} - ${userBalance} ETH`);
    console.log(
      `  CMA: ${await cmaDeployment.cacheManagerAutomation.getAddress()}`
    );
    console.log('---------------------------------------');

    console.log('---------------------------------------');
  });

  beforeEach(async function () {
    await evictAll();
  });

  afterEach(async () => {});

  describe('Deployment', async function () {
    describe('First Deployment', async function () {
      it('Should set the right owner', async function () {
        expect(await cmaDeployment.cacheManagerAutomation.owner()).to.equal(
          owner.address
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
    xdescribe('Upgradable', async function () {
      it('Should be upgradable [TODO]', async function () {});
    });
  });

  describe('Contract Management', function () {
    describe('Contract Insertion', function () {
      it('Should insert a contract to CMA', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const caseValidatedContract = hre.ethers.getAddress(contract);

        await expect(
          insertContract(caseValidatedContract, DEFAULT_MAX_BID, true, user)
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
          .withArgs(user.address, caseValidatedContract, DEFAULT_MAX_BID);

        await verifyContractExists(caseValidatedContract, DEFAULT_MAX_BID);
      });

      it('Should insert several contracts to CMA', async function () {
        const contractCount = 3;
        const contracts = await deployDummyWASMContracts(contractCount);
        const contractAddresses = contracts.map((contract) =>
          hre.ethers.getAddress(contract)
        );

        const userContractsBefore = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        // Insert each contract and verify event emission
        for (let i = 0; i < contractCount; i++) {
          await expect(
            insertContract(contractAddresses[i], DEFAULT_MAX_BID, true, user)
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
            .withArgs(user.address, contractAddresses[i], DEFAULT_MAX_BID);
        }

        // Verify all contracts exist in the user's contract list
        for (const contractAddress of contractAddresses) {
          await verifyContractExists(contractAddress, DEFAULT_MAX_BID);
        }

        // Verify the user has the correct number of contracts
        const userContractsAfter = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();
        expect(userContractsAfter.length - userContractsBefore.length).to.equal(
          contractCount
        );
      });

      it('Should insert several contracts from diff wallets to CMA', async function () {
        const walletCount = 3;
        const contracts = await deployDummyWASMContracts(walletCount);
        const contractAddresses = contracts.map((contract) =>
          hre.ethers.getAddress(contract)
        );

        // Create and fund multiple wallets
        const extraWallets = await createAndFundWallets(walletCount);

        // Each wallet inserts a different contract
        for (let i = 0; i < walletCount; i++) {
          await expect(
            insertContract(
              contractAddresses[i],
              DEFAULT_MAX_BID,
              true,
              extraWallets[i]
            )
          )
            .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractAdded')
            .withArgs(
              extraWallets[i].address,
              contractAddresses[i],
              DEFAULT_MAX_BID
            );
        }

        // Verify each wallet has their respective contract
        for (let i = 0; i < walletCount; i++) {
          await verifyContractExists(
            contractAddresses[i],
            DEFAULT_MAX_BID,
            extraWallets[i]
          );

          // Verify each wallet has exactly one contract
          const userContracts = await cmaDeployment.cacheManagerAutomation
            .connect(extraWallets[i])
            .getUserContracts();
          expect(userContracts.length).to.equal(1);
          expect(userContracts[0].contractAddress).to.equal(
            contractAddresses[i]
          );
        }
      });

      it('Should insert a contract to CMA and fund user balance', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const caseValidatedContract = hre.ethers.getAddress(contract);

        const initialUserBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();

        await insertContract(
          caseValidatedContract,
          DEFAULT_MAX_BID,
          true,
          user,
          hre.ethers.parseEther('0.001')
        );

        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(
          initialUserBalance + hre.ethers.parseEther('0.001')
        );
      });
    });
    describe('Contract Removal', function () {
      it('Should remove a contract from CMA', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const caseValidatedContract = hre.ethers.getAddress(contract);

        // Add contract first
        await insertContract(caseValidatedContract, DEFAULT_MAX_BID, true);

        // Remove the contract and check event emission
        await expect(
          cmaDeployment.cacheManagerAutomation
            .connect(user)
            .removeContract(caseValidatedContract)
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user.address, caseValidatedContract);

        await verifyContractRemoved(caseValidatedContract, user);
      });

      it('Should remove all contracts from CMA', async function () {
        const contractCount = 3;
        const contracts = await deployDummyWASMContracts(contractCount);
        const contractAddresses = contracts.map((contract) =>
          hre.ethers.getAddress(contract)
        );

        // Insert each contract and verify event emission
        for (let i = 0; i < contractCount; i++) {
          await insertContract(
            contractAddresses[i],
            DEFAULT_MAX_BID,
            true,
            user
          );
        }

        // Remove all contracts and check for event emissions
        await expect(
          cmaDeployment.cacheManagerAutomation
            .connect(user)
            .removeAllContracts()
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[0]) // Checks the first contract removed
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[1]) // Checks the second contract removed
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(user.address, contractAddresses[2]); // Checks the third contract removed

        // Ensure all contracts were removed
        await verifyContractRemoved(contractAddresses[0], user);
        await verifyContractRemoved(contractAddresses[1], user);
        await verifyContractRemoved(contractAddresses[2], user);
      });

      it('Should remove some contracts from diff wallets while others remain', async function () {
        const walletCount = 3;
        const contracts = await deployDummyWASMContracts(walletCount);
        const contractAddresses = contracts.map((contract) =>
          hre.ethers.getAddress(contract)
        );

        // Create and fund multiple wallets
        const extraWallets = await createAndFundWallets(walletCount);

        // Each wallet inserts a different contract
        for (let i = 0; i < walletCount; i++) {
          await insertContract(
            contractAddresses[i],
            DEFAULT_MAX_BID,
            true,
            extraWallets[i]
          );
        }

        // Verify all contracts are initially present
        for (let i = 0; i < walletCount; i++) {
          await verifyContractExists(
            contractAddresses[i],
            DEFAULT_MAX_BID,
            extraWallets[i]
          );
        }

        // Remove all contracts from wallet 0 using removeAllContracts
        await expect(
          cmaDeployment.cacheManagerAutomation
            .connect(extraWallets[0])
            .removeAllContracts()
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(extraWallets[0].address, contractAddresses[0]);

        // Remove one specific contract from wallet 1 using removeContract
        await expect(
          cmaDeployment.cacheManagerAutomation
            .connect(extraWallets[1])
            .removeContract(contractAddresses[1])
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'ContractRemoved')
          .withArgs(extraWallets[1].address, contractAddresses[1]);

        // Verify wallet 0 has no contracts
        await verifyContractRemoved(contractAddresses[0], extraWallets[0]);
        const wallet0Contracts = await cmaDeployment.cacheManagerAutomation
          .connect(extraWallets[0])
          .getUserContracts();
        expect(wallet0Contracts.length).to.equal(0);

        // Verify wallet 1 has no contracts
        await verifyContractRemoved(contractAddresses[1], extraWallets[1]);
        const wallet1Contracts = await cmaDeployment.cacheManagerAutomation
          .connect(extraWallets[1])
          .getUserContracts();
        expect(wallet1Contracts.length).to.equal(0);

        // Verify wallet 2 still has its contract
        await verifyContractExists(
          contractAddresses[2],
          DEFAULT_MAX_BID,
          extraWallets[2]
        );
        const wallet2Contracts = await cmaDeployment.cacheManagerAutomation
          .connect(extraWallets[2])
          .getUserContracts();
        expect(wallet2Contracts.length).to.equal(1);
        expect(wallet2Contracts[0].contractAddress).to.equal(
          contractAddresses[2]
        );
      });
    });
    describe('Contract Updates', function () {
      it('Should update a contract max bid', async function () {
        const [contract] = await deployDummyWASMContracts(1);

        const contractToCacheAddress = hre.ethers.getAddress(contract);

        await insertContract(contractToCacheAddress, DEFAULT_MAX_BID, true);

        const updatedMaxBid = DEFAULT_MAX_BID + 1n;

        await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .updateContract(contractToCacheAddress, updatedMaxBid, true);

        // verify max bid was updated
        const userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        const updatedContract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(updatedContract?.maxBid).to.equal(updatedMaxBid);
      });

      it('Should update a contract enabled status', async function () {
        const [contract] = await deployDummyWASMContracts(1);

        const contractToCacheAddress = hre.ethers.getAddress(contract);

        await insertContract(contractToCacheAddress, DEFAULT_MAX_BID, true);

        await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .updateContract(contractToCacheAddress, DEFAULT_MAX_BID, false);

        // verify max bid was updated
        const userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        const updatedContract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(updatedContract?.enabled).to.equal(false);
      });

      it('Should update a contract enabled status and max bid', async function () {
        const [contract] = await deployDummyWASMContracts(1);

        const contractToCacheAddress = hre.ethers.getAddress(contract);

        await insertContract(contractToCacheAddress, DEFAULT_MAX_BID, true);

        const updatedMaxBid = DEFAULT_MAX_BID + 1n;

        await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .updateContract(contractToCacheAddress, updatedMaxBid, false);

        // verify max bid was updated
        const userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        const updatedContract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(updatedContract?.enabled).to.equal(false);
        expect(updatedContract?.maxBid).to.equal(updatedMaxBid);
      });

      it('Should allow enabling and disabling contracts more than once', async function () {
        const [contract] = await deployDummyWASMContracts(1);

        const contractToCacheAddress = hre.ethers.getAddress(contract);

        await insertContract(contractToCacheAddress, DEFAULT_MAX_BID, true);

        await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .updateContract(contractToCacheAddress, DEFAULT_MAX_BID, false);

        let userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        let updatedContract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(updatedContract?.enabled).to.equal(false);

        await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .updateContract(contractToCacheAddress, DEFAULT_MAX_BID, true);

        userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserContracts();

        updatedContract = userContracts.find(
          (c) => c.contractAddress === contractToCacheAddress
        );
        expect(updatedContract?.enabled).to.equal(true);
      });
    });
  });

  describe('Balance Management', function () {
    describe('Fund Balance', function () {
      it('Should allow users to fund their balance', async function () {
        const fundAmount = hre.ethers.parseEther('0.005');
        const initialBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();

        await expect(
          cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
            value: fundAmount,
          })
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'BalanceUpdated')
          .withArgs(user.address, initialBalance + fundAmount);

        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(initialBalance + fundAmount);
      });

      it('Should revert when funding with less than MIN_FUND_AMOUNT', async function () {
        await expect(
          cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
            value: 0,
          })
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'InvalidFundAmount'
        );
      });

      it('Should accumulate balance when funding multiple times', async function () {
        const initialAmount = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        const fundAmount1 = hre.ethers.parseEther('0.001');
        const fundAmount2 = hre.ethers.parseEther('0.002');

        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: fundAmount1,
        });
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: fundAmount2,
        });

        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(initialAmount + fundAmount1 + fundAmount2);
      });
    });

    describe('Withdraw Balance', function () {
      it('Should allow users to withdraw their balance', async function () {
        const initialAmount = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        const fundAmount = hre.ethers.parseEther('0.005');

        // Fund the balance first
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: fundAmount,
        });

        // Check user's ETH balance before withdrawal
        const balanceBefore = await hre.ethers.provider.getBalance(
          user.address
        );

        // Withdraw and track gas costs
        const tx = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .withdrawBalance();
        const receipt = await tx.wait();

        // Calculate actual gas cost using effectiveGasPrice (EIP-1559 compatible)
        const gasUsed = receipt ? receipt.gasUsed : 0n;
        const effectiveGasPrice = receipt ? receipt.gasPrice : 0n;
        const gasCost = gasUsed * effectiveGasPrice;

        // Check user's ETH balance after withdrawal
        const balanceAfter = await hre.ethers.provider.getBalance(user.address);

        // Verify balance increased by the expected amount (accounting for gas)
        const expectedBalanceAfter =
          balanceBefore + fundAmount + initialAmount - gasCost;

        expect(balanceAfter).to.be.closeTo(
          expectedBalanceAfter,
          hre.ethers.parseEther('0.00001')
        );

        // Verify user balance in contract is now zero
        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(0);
      });

      it('Should revert when withdrawing with zero balance', async function () {
        await expect(
          cmaDeployment.cacheManagerAutomation.connect(user).withdrawBalance()
        ).to.be.revertedWithCustomError(
          cmaDeployment.cacheManagerAutomation,
          'InsufficientBalance'
        );
      });

      it('Should emit BalanceUpdated event when withdrawing', async function () {
        const fundAmount = hre.ethers.parseEther('0.005');

        // Fund the balance first
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: fundAmount,
        });

        // Withdraw and check for event
        await expect(
          cmaDeployment.cacheManagerAutomation.connect(user).withdrawBalance()
        )
          .to.emit(cmaDeployment.cacheManagerAutomation, 'BalanceUpdated')
          .withArgs(user.address, 0);
      });
    });
  });

  describe('Bidding Mechanism', function () {
    before(async function () {
      cmaDeployment = await deployCMA(); // Clean CMA for this section
      console.log(
        'New Clean CMA deployed at:',
        await cmaDeployment.cacheManagerAutomation.getAddress()
      );
    });
    describe('Automation', function () {
      it('Should do nothing when no contracts are registered', async function () {
        const ownerAddress = await owner.getAddress();
        const userAddress = await user.getAddress();
        const [contract1, contract2] = await deployDummyWASMContracts(2);
        const bidRequests = [
          {
            contractAddress: contract1,
            user: ownerAddress,
          },
          {
            contractAddress: contract2,
            user: userAddress,
          },
        ];
        // expect to emit no events
        // Owner
        const tx = await cmaDeployment.cacheManagerAutomation.placeBids(
          bidRequests
        );
        const receipt = await tx.wait();
        const events = logTransactionEvents(receipt);
        expect(events).to.be.empty;
      });

      it('Should place bid when minBid < maxBid and contract is not cached and user has enough balance', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const contractToCacheAddress = hre.ethers.getAddress(contract);
        const maxBid = hre.ethers.parseEther('0.001');
        const biddingFunds = hre.ethers.parseEther('0.01');
        await insertContract(contractToCacheAddress, maxBid, true, user);
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: biddingFunds,
        });

        const bidRequest = {
          contractAddress: contractToCacheAddress,
          user: await user.getAddress(),
        };

        const tx = await cmaDeployment.cacheManagerAutomation.placeBids([
          bidRequest,
        ]);
        const receipt = await tx.wait();
        const events = logTransactionEvents(receipt);

        // Validate that the expected events were emitted
        const eventNames = events.map((event) => event.eventName);
        expect(eventNames).to.include('BidPlaced');
      });

      it('Should deduct balance when bid is placed and minBid != 0', async function () {
        const [contract, auxContract, auxContract2] =
          await deployDummyWASMContracts(3);
        const contractToCacheAddress = hre.ethers.getAddress(contract);
        const auxContractToCacheAddress = hre.ethers.getAddress(auxContract);
        const auxContract2ToCacheAddress = hre.ethers.getAddress(auxContract2);

        await cmaDeployment.cacheManager.placeBid(auxContractToCacheAddress, {
          value: hre.ethers.parseEther('0.0005'),
        });
        await cmaDeployment.cacheManager.placeBid(auxContract2ToCacheAddress, {
          value: hre.ethers.parseEther('0.0005'),
        });

        const minBid = await cmaDeployment.cacheManager['getMinBid(address)'](
          contractToCacheAddress
        );
        expect(minBid).to.equal(hre.ethers.parseEther('0.0005'));

        const maxBid = hre.ethers.parseEther('0.001');
        const biddingFunds = hre.ethers.parseEther('0.002');
        await insertContract(contractToCacheAddress, maxBid, true, user);
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: biddingFunds,
        });
        const initialUserBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();

        const bidRequest = {
          contractAddress: contractToCacheAddress,
          user: await user.getAddress(),
        };

        const tx = await cmaDeployment.cacheManagerAutomation.placeBids([
          bidRequest,
        ]);
        const receipt = await tx.wait();
        const events = logTransactionEvents(receipt);

        // Validate that the expected events were emitted
        const bidPlacedEvent = events.find(
          (event) => event.eventName === 'BidPlaced'
        );
        expect(bidPlacedEvent).to.not.be.undefined;
        const bidAmount = bidPlacedEvent?.args[2];

        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(initialUserBalance - bidAmount);
      });

      it('Should not place bid when minBid < maxBid and contract is cached', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const contractToCacheAddress = hre.ethers.getAddress(contract);
        const maxBid = hre.ethers.parseEther('0.001');
        const biddingFunds = hre.ethers.parseEther('0.01');
        await insertContract(contractToCacheAddress, maxBid, true, user);
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: biddingFunds,
        });

        const bidRequest = {
          contractAddress: contractToCacheAddress,
          user: await user.getAddress(),
        };

        await cmaDeployment.cacheManagerAutomation.placeBids([bidRequest]);

        const tx = await cmaDeployment.cacheManagerAutomation.placeBids([
          bidRequest,
        ]);
        const receipt = await tx.wait();
        const eventNames = logTransactionEvents(receipt);
        expect(eventNames).to.be.empty;
      });

      it('Should skip disabled contracts', async function () {
        const [contract] = await deployDummyWASMContracts(1);
        const contractToCacheAddress = hre.ethers.getAddress(contract);
        const maxBid = hre.ethers.parseEther('0.001');
        const biddingFunds = hre.ethers.parseEther('0.01');
        await insertContract(contractToCacheAddress, maxBid, false, user);
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: biddingFunds,
        });

        const bidRequest = {
          contractAddress: contractToCacheAddress,
          user: await user.getAddress(),
        };

        await cmaDeployment.cacheManagerAutomation.placeBids([bidRequest]);

        const tx = await cmaDeployment.cacheManagerAutomation.placeBids([
          bidRequest,
        ]);
        const receipt = await tx.wait();
        const eventNames = logTransactionEvents(receipt);
        expect(eventNames).to.be.empty;
      });

      it('Should handle multiple contracts from the same user correctly', async function () {
        this.timeout(0);
        const [auxContract, auxContract2] = await deployDummyWASMContracts(3);
        const auxContractToCacheAddress = hre.ethers.getAddress(auxContract);
        const auxContract2ToCacheAddress = hre.ethers.getAddress(auxContract2);

        await cmaDeployment.cacheManager.placeBid(auxContractToCacheAddress, {
          value: hre.ethers.parseEther('0'),
        });
        await cmaDeployment.cacheManager.placeBid(auxContract2ToCacheAddress, {
          value: hre.ethers.parseEther('0'),
        });

        const minBid = await cmaDeployment.cacheManager['getMinBid(address)'](
          auxContractToCacheAddress
        );
        expect(minBid).to.equal(hre.ethers.parseEther('0')); // May fail due to decay, just re-run.
        const fetchInitialUserContracts =
          await cmaDeployment.cacheManagerAutomation
            .connect(user)
            .getContracts();
        const initialUserContracts =
          fetchInitialUserContracts.length > 0
            ? fetchInitialUserContracts[0].contracts
            : [];

        const contracts = await deployDummyWASMContracts(5);
        const maxBid = hre.ethers.parseEther('0.001');
        const biddingFunds = hre.ethers.parseEther('0.01');
        for (const contract of contracts) {
          await insertContract(contract, maxBid, true, user);
        }
        await cmaDeployment.cacheManagerAutomation.connect(user).fundBalance({
          value: biddingFunds,
        });

        const userAddress = await user.getAddress();
        const bidRequests = contracts.slice(2, 4).map((contract) => ({
          contractAddress: contract,
          user: userAddress,
        }));

        const initialUserBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();

        const tx = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .placeBids(bidRequests);
        const receipt = await tx.wait();
        const events = logTransactionEvents(receipt);
        // expect to have 5 BidPlaced events
        const bidPlacedEvents = events.filter(
          (event) => event.eventName === 'BidPlaced'
        );
        expect(bidPlacedEvents.length).to.equal(bidRequests.length);

        const bidPlacedTotalAmount = bidPlacedEvents.reduce(
          (acc, event) => acc + event.args[2],
          0n
        );
        const userBalance = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getUserBalance();
        expect(userBalance).to.equal(initialUserBalance - bidPlacedTotalAmount);

        const userContracts = await cmaDeployment.cacheManagerAutomation
          .connect(user)
          .getContracts();
        expect(userContracts[0].contracts.length).to.equal(
          initialUserContracts.length + bidRequests.length
        );
        expect(userContracts[0].user).to.equal(userAddress);

        // expect all dummy contracts to be returned
        expect(
          userContracts[0].contracts.map((contract) => contract.contractAddress)
        ).to.deep.equal([
          ...initialUserContracts.map((c) => c.contractAddress),
          ...contracts,
        ]);
      });
    });

    it('Should handle partial success when some bids succeed and others fail', async function () {});
  });

  xdescribe('Emergency Functions', function () {
    describe('Pause/Unpause', function () {});
  });

  xdescribe('Edge Cases', function () {});
});
