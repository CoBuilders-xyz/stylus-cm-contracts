import { ethers } from 'ethers';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import { abi as CacheManagerProxyABI } from '../../artifacts/src/contracts/CacheManagerProxy.sol/CacheManagerProxy.json';

dotenv.config();

const ALERT_THRESHOLD = ethers.parseEther('1.0'); // 1 ETH
const LOW_SUCCESS_RATE_THRESHOLD = 0.8; // 80%
const DEBUG = false;

export class CacheManagerMonitor {
  private contract: ethers.Contract;
  private db: any;
  private isMonitoring: boolean = false;
  private testId: string;
  private provider: ethers.Provider;

  constructor(
    contractAddress: string,
    provider: ethers.Provider,
    initialTestId: string
  ) {
    this.provider = provider;
    this.contract = new ethers.Contract(
      contractAddress,
      CacheManagerProxyABI,
      provider
    );
    this.testId = initialTestId;
  }

  private log(...args: any[]) {
    if (DEBUG) {
      console.log('[Monitor]:', ...args);
    }
  }

  private logError(...args: any[]) {
    if (DEBUG) {
      console.error('[Monitor Error]:', ...args);
    }
  }

  async setTestId(newTestId: string) {
    this.testId = newTestId;
    if (!this.db) {
      await this.initDB(false);
    }
    this.log(`Test ID set to: ${this.testId}`);
  }

  async setContractAddress(newContractAddress: string) {
    if (this.contract) {
      this.contract.removeAllListeners();
    }

    this.contract = new ethers.Contract(
      newContractAddress,
      CacheManagerProxyABI,
      this.provider
    );

    this.log(`Contract address set to: ${newContractAddress}`);
  }

  private async attachEventListeners() {
    this.log('Attaching event listeners...');

    this.contract.on('BidDetails', async (...args) => {
      this.log('BidDetails event received:', ...args);
      try {
        const [user, contract, bidAmount, minBid, maxBid, balance, success] =
          args;
        await this.processBidEvent(
          user,
          contract,
          bidAmount,
          minBid,
          maxBid,
          balance,
          success
        );
      } catch (error) {
        this.logError('Error processing BidDetails event:', error);
      }
    });

    this.contract.on('UpkeepPerformed', async (...args) => {
      this.log('UpkeepPerformed event received:', ...args);
      try {
        const [total, successful, failed, timestamp] = args;
        await this.processUpkeepEvent(total, successful, failed, timestamp);
      } catch (error) {
        this.logError('Error processing UpkeepPerformed event:', error);
      }
    });

    this.contract.on('error', (error) => {
      this.logError('Contract event error:', error);
    });

    this.log('Event listeners attached successfully');
  }

  private async initDB(clean: boolean = false) {
    this.db = await open({
      filename: 'test/db/monitor.db',
      driver: sqlite3.Database,
    });

    if (clean) {
      await this.clearDatabase();
    }

    // Create tables
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS bids (
        test_id TEXT,
        user TEXT,
        contract TEXT,
        bid_amount TEXT,
        min_bid TEXT,
        max_bid TEXT,
        balance TEXT,
        success INTEGER,
        timestamp DATETIME
      );

      CREATE TABLE IF NOT EXISTS upkeeps (
        test_id TEXT,
        total_contracts TEXT,
        successful_bids TEXT,
        failed_bids TEXT,
        timestamp DATETIME
      );

      CREATE TABLE IF NOT EXISTS balance_operations (
        test_id TEXT,
        user TEXT,
        operation TEXT,
        amount TEXT,
        new_balance TEXT,
        timestamp DATETIME
      );
    `);
  }

  async clearDatabase() {
    console.log('Clearing database...');
    await this.db.exec(`
      DROP TABLE IF EXISTS bids;
      DROP TABLE IF EXISTS upkeeps;
      DROP TABLE IF EXISTS balance_operations;
    `);
    console.log('Database cleared');
  }

  async startMonitoring(cleanDB: boolean = false) {
    if (this.isMonitoring) {
      await this.stopMonitoring();
    }

    this.log('Starting monitoring...');
    this.log(`Contract address: ${await this.contract.getAddress()}`);
    this.log(`Test ID: ${this.testId}`);

    await this.initDB(cleanDB);
    await this.attachEventListeners();
    this.isMonitoring = true;

    this.log('Monitoring started successfully');
  }

  private async processBidEvent(
    user: string,
    contract: string,
    bidAmount: bigint,
    minBid: bigint,
    maxBid: bigint,
    balance: bigint,
    success: boolean
  ) {
    this.log(`Processing bid event for test ${this.testId}`);
    try {
      if (!this.db) {
        await this.initDB(false);
      }

      const query = `
        INSERT INTO bids (test_id, user, contract, bid_amount, min_bid, max_bid, balance, success, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const params = [
        this.testId,
        user,
        contract,
        bidAmount.toString(),
        minBid.toString(),
        maxBid.toString(),
        balance.toString(),
        success ? 1 : 0,
        new Date().toISOString(),
      ];

      this.log('Executing query:', query);
      this.log('With params:', params);

      await this.db.run(query, params);
      this.log('Bid event stored successfully in database');
    } catch (error) {
      this.logError('Error storing bid event:', error);
      this.logError(
        'Error details:',
        error instanceof Error ? error.stack : error
      );
    }

    if (bidAmount > ALERT_THRESHOLD) {
      await this.sendAlert(
        `High bid detected: ${ethers.formatEther(bidAmount)} ETH from ${user}`
      );
    }
  }

  private async processUpkeepEvent(
    total: bigint,
    successful: bigint,
    failed: bigint,
    timestamp: bigint
  ) {
    const successRate =
      Number(successful) / (Number(successful) + Number(failed));

    if (successRate < LOW_SUCCESS_RATE_THRESHOLD) {
      await this.sendAlert(
        `Low bid success rate: ${(successRate * 100).toFixed(2)}%`
      );
    }

    await this.db.run(
      `
      INSERT INTO upkeeps (test_id, total_contracts, successful_bids, failed_bids, timestamp)
      VALUES (?, ?, ?, ?, ?)`,
      [
        this.testId,
        total.toString(),
        successful.toString(),
        failed.toString(),
        new Date(Number(timestamp) * 1000).toISOString(),
      ]
    );
  }

  private async processBalanceEvent(
    user: string,
    operation: string,
    amount: bigint,
    newBalance: bigint,
    timestamp: bigint
  ) {
    await this.db.run(
      `
      INSERT INTO balance_operations (test_id, user, operation, amount, new_balance, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        this.testId,
        user,
        operation,
        amount.toString(),
        newBalance.toString(),
        new Date(Number(timestamp) * 1000).toISOString(),
      ]
    );

    if (operation === 'withdraw' && amount > ALERT_THRESHOLD) {
      await this.sendAlert(
        `Large withdrawal: ${ethers.formatEther(amount)} ETH by ${user}`
      );
    }
  }

  private async sendAlert(message: string) {
    console.log(`ALERT: ${message}`);
  }

  async checkDatabase() {
    console.log(`Checking database for test ${this.testId}`);
    if (!this.db) {
      console.log('Database not initialized, initializing now...');
      await this.initDB(false);
    }
    const bids = await this.db.all('SELECT * FROM bids WHERE test_id = ?', [
      this.testId,
    ]);
    console.log('Current bids in database:', bids);
    return bids;
  }

  async stopMonitoring() {
    if (!this.isMonitoring) {
      console.log('Monitor is not running');
      return;
    }

    this.log('Stopping monitoring...');
    this.contract.removeAllListeners();
    await this.db.close();
    this.isMonitoring = false;
    this.log('Monitoring stopped successfully');
  }
}

// TODO make function for waiting arbitrary time for known events to be emitted.

// Only start monitoring if this file is run directly
if (require.main === module) {
  const monitor = new CacheManagerMonitor(
    process.env.CACHE_MANAGER_PROXY_ADDRESS!,
    new ethers.JsonRpcProvider(process.env.RPC_URL),
    process.env.TEST_ID!
  );
  monitor.startMonitoring().catch(console.error);
}
