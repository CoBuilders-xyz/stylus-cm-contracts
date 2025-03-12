import { ethers } from 'ethers';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import { abi as CacheManagerProxyABI } from '../../artifacts/src/contracts/CacheManagerProxy.sol/CacheManagerProxy.json';

dotenv.config();

const ALERT_THRESHOLD = ethers.parseEther('1.0'); // 1 ETH
const LOW_SUCCESS_RATE_THRESHOLD = 0.8; // 80%

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

  async setTestId(newTestId: string) {
    this.testId = newTestId;
  }

  async setContractAddress(newContractAddress: string) {
    this.contract = new ethers.Contract(
      newContractAddress,
      CacheManagerProxyABI,
      this.provider
    );
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
    if (this.isMonitoring) return;

    await this.initDB(cleanDB);
    this.isMonitoring = true;

    this.contract.on(
      'BidDetails',
      async (user, contract, bidAmount, minBid, maxBid, balance, success) => {
        console.log('BidDetails event received');
        await this.processBidEvent(
          user,
          contract,
          bidAmount,
          minBid,
          maxBid,
          balance,
          success
        );
      }
    );

    this.contract.on(
      'UpkeepPerformed',
      async (total, successful, failed, timestamp) => {
        await this.processUpkeepEvent(total, successful, failed, timestamp);
      }
    );

    this.contract.on(
      'UserBalanceOperation',
      async (user, operation, amount, newBalance, timestamp) => {
        await this.processBalanceEvent(
          user,
          operation,
          amount,
          newBalance,
          timestamp
        );
      }
    );
  }

  async stopMonitoring() {
    if (!this.isMonitoring) return;

    this.contract.removeAllListeners();
    await this.db.close();
    this.isMonitoring = false;
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
    try {
      await this.db.run(
        `
        INSERT INTO bids (test_id, user, contract, bid_amount, min_bid, max_bid, balance, success, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.testId,
          user,
          contract,
          bidAmount.toString(),
          minBid.toString(),
          maxBid.toString(),
          balance.toString(),
          success ? 1 : 0,
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.error('Error storing bid event:', error);
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

  // Add method to check database content
  async checkDatabase() {
    const bids = await this.db.all('SELECT * FROM bids');
    console.log('Current bids in database:', bids);
    return bids;
  }
}

// Only start monitoring if this file is run directly
if (require.main === module) {
  const monitor = new CacheManagerMonitor(
    process.env.CACHE_MANAGER_PROXY_ADDRESS!,
    new ethers.JsonRpcProvider(process.env.RPC_URL),
    process.env.TEST_ID!
  );
  monitor.startMonitoring().catch(console.error);
}
