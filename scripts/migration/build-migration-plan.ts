/**
 * Turns a state dump produced by dump-cma-state.ts into a per-user migration
 * plan that the UI can consume. Each user's plan is a flat, ordered list of
 * actions; the UI just walks the array, presenting one Sign-and-send button
 * per step.
 *
 * Defaults reflect the post-migration policy:
 *   - The new contract preserves enabled/maxBid 1:1 from the legacy state.
 *   - autoActivate is set to FALSE so existing users opt in to the activation
 *     feature explicitly (no surprise spend of their escrow on activations).
 *   - The new escrow balance equals the legacy balance (rounded down to the
 *     refund actually returned by withdrawBalance).
 *
 * Usage:
 *   npx ts-node scripts/migration/build-migration-plan.ts \
 *     --dump migration-state-arbitrumOne.json \
 *     --new-cma 0xNEW... \
 *     --out migration-plan-arbitrumOne.json
 */
import * as fs from 'fs';
import * as path from 'path';

interface DumpedContract {
  contractAddress: string;
  maxBid: string;
  enabled: boolean;
}

interface DumpedUser {
  user: string;
  balance: string;
  contracts: DumpedContract[];
}

interface StateDump {
  network: string;
  cma: string;
  escrow: string;
  blockNumber: number;
  snapshotAt: string;
  totalUsers: number;
  totalContracts: number;
  totalEscrowWei: string;
  users: DumpedUser[];
}

type Action =
  | {
      step: number;
      kind: 'withdrawLegacy';
      to: string;
      method: 'withdrawBalance()';
      expectedRefundWei: string;
    }
  | {
      step: number;
      kind: 'fundAndInsertNew';
      to: string;
      method:
        | 'insertContract(address,uint256,bool,bool,uint256)';
      args: {
        contractAddress: string;
        maxBid: string;
        enabled: boolean;
        autoActivate: false;
        maxActivationCost: '0';
      };
      valueWei: string;
    }
  | {
      step: number;
      kind: 'insertNew';
      to: string;
      method: 'insertContract(address,uint256,bool,bool,uint256)';
      args: {
        contractAddress: string;
        maxBid: string;
        enabled: boolean;
        autoActivate: false;
        maxActivationCost: '0';
      };
    };

interface UserPlan {
  user: string;
  legacyBalanceWei: string;
  legacyContractsCount: number;
  actions: Action[];
}

interface MigrationPlan {
  network: string;
  legacyCma: string;
  newCma: string;
  generatedAt: string;
  basedOnSnapshot: { blockNumber: number; snapshotAt: string };
  users: UserPlan[];
}

function parseArgs(): {
  dumpPath: string;
  newCma: string;
  outPath: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  };
  const dumpPath = get('--dump');
  const newCma = get('--new-cma');
  const outPath = get('--out');
  if (!dumpPath || !newCma || !outPath) {
    console.error(
      'Usage: build-migration-plan.ts --dump <state.json> --new-cma 0x... --out <plan.json>'
    );
    process.exit(1);
  }
  return { dumpPath, newCma, outPath };
}

function buildUserPlan(
  user: DumpedUser,
  legacyCma: string,
  newCma: string
): UserPlan {
  const actions: Action[] = [];
  let step = 1;

  if (BigInt(user.balance) > 0n) {
    actions.push({
      step: step++,
      kind: 'withdrawLegacy',
      to: legacyCma,
      method: 'withdrawBalance()',
      expectedRefundWei: user.balance,
    });
  }

  // First contract carries the entire balance as the funding value so the new
  // escrow ends up matching the legacy one in a single tx. Remaining contracts
  // are inserted with no value attached.
  user.contracts.forEach((c, i) => {
    if (i === 0 && BigInt(user.balance) > 0n) {
      actions.push({
        step: step++,
        kind: 'fundAndInsertNew',
        to: newCma,
        method: 'insertContract(address,uint256,bool,bool,uint256)',
        args: {
          contractAddress: c.contractAddress,
          maxBid: c.maxBid,
          enabled: c.enabled,
          autoActivate: false,
          maxActivationCost: '0',
        },
        valueWei: user.balance,
      });
    } else {
      actions.push({
        step: step++,
        kind: 'insertNew',
        to: newCma,
        method: 'insertContract(address,uint256,bool,bool,uint256)',
        args: {
          contractAddress: c.contractAddress,
          maxBid: c.maxBid,
          enabled: c.enabled,
          autoActivate: false,
          maxActivationCost: '0',
        },
      });
    }
  });

  return {
    user: user.user,
    legacyBalanceWei: user.balance,
    legacyContractsCount: user.contracts.length,
    actions,
  };
}

function main() {
  const { dumpPath, newCma, outPath } = parseArgs();
  const dump: StateDump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

  const plan: MigrationPlan = {
    network: dump.network,
    legacyCma: dump.cma,
    newCma,
    generatedAt: new Date().toISOString(),
    basedOnSnapshot: {
      blockNumber: dump.blockNumber,
      snapshotAt: dump.snapshotAt,
    },
    users: dump.users.map((u) => buildUserPlan(u, dump.cma, newCma)),
  };

  fs.writeFileSync(path.resolve(outPath), JSON.stringify(plan, null, 2));
  console.log(`✅ Wrote ${outPath}`);
  console.log(
    `   ${plan.users.length} users, ${plan.users.reduce(
      (a, u) => a + u.actions.length,
      0
    )} total actions`
  );
}

main();
