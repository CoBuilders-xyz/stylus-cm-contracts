/**
 * Reads the full state of an existing CacheManagerAutomation deployment so we
 * can plan the activation-feature migration. Pure read, no transactions.
 *
 * Usage:
 *   CMA_ADDRESS=0x... npx hardhat run scripts/migration/dump-cma-state.ts \
 *     --network arbitrumOne
 *
 * Output: writes ./migration-state-<network>.json with
 *   { network, cma, blockNumber, totalUsers, users: [{ user, balance, contracts: [...] }] }
 */
import hre from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Minimal ABIs — we only call the read methods that exist on every deployed
// version of the contract pre-activation feature.
const CMA_READ_ABI = [
  'function escrow() view returns (address)',
  'function getTotalUsersCount() view returns (uint256)',
  'function getContractsPaginated(uint256 offset, uint256 limit) view returns (tuple(address user, tuple(address contractAddress, uint256 maxBid, bool enabled)[] contracts)[] userData, bool hasMore)',
];
const ESCROW_ABI = ['function depositsOf(address) view returns (uint256)'];

const PAGE_SIZE = 50n;

async function main() {
  const cmaAddress = process.env.CMA_ADDRESS;
  if (!cmaAddress) {
    throw new Error('Missing CMA_ADDRESS env var');
  }
  const networkName = hre.network.name;
  const provider = hre.ethers.provider;

  console.log(`📷 Snapshotting CMA at ${cmaAddress} on ${networkName}`);

  const cma = new hre.ethers.Contract(cmaAddress, CMA_READ_ABI, provider);
  const escrowAddress: string = await cma.escrow();
  const escrow = new hre.ethers.Contract(escrowAddress, ESCROW_ABI, provider);
  console.log(`   Escrow: ${escrowAddress}`);

  const totalUsers: bigint = await cma.getTotalUsersCount();
  console.log(`   Users with contracts: ${totalUsers}`);

  const users: Array<{
    user: string;
    balance: string;
    contracts: Array<{ contractAddress: string; maxBid: string; enabled: boolean }>;
  }> = [];

  for (let offset = 0n; offset < totalUsers; offset += PAGE_SIZE) {
    const [page, hasMore] = await cma.getContractsPaginated(offset, PAGE_SIZE);
    for (const entry of page) {
      const balance: bigint = await escrow.depositsOf(entry.user);
      users.push({
        user: entry.user,
        balance: balance.toString(),
        contracts: entry.contracts.map((c: any) => ({
          contractAddress: c.contractAddress,
          maxBid: c.maxBid.toString(),
          enabled: c.enabled,
        })),
      });
    }
    if (!hasMore) break;
  }

  const blockNumber = await provider.getBlockNumber();
  const out = {
    network: networkName,
    cma: cmaAddress,
    escrow: escrowAddress,
    blockNumber,
    snapshotAt: new Date().toISOString(),
    totalUsers: Number(totalUsers),
    totalContracts: users.reduce((acc, u) => acc + u.contracts.length, 0),
    totalEscrowWei: users
      .reduce((acc, u) => acc + BigInt(u.balance), 0n)
      .toString(),
    users,
  };

  const fileName = `migration-state-${networkName}.json`;
  const outPath = path.join(process.cwd(), fileName);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote ${outPath}`);
  console.log(
    `   ${out.totalUsers} users, ${out.totalContracts} contracts, escrow total ${hre.ethers.formatEther(out.totalEscrowWei)} ETH`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
