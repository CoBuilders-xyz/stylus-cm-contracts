import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import hre from 'hardhat';
import dotenv from 'dotenv';
import { Contract, Wallet, formatEther, parseEther } from 'ethers';

type Role = 'both' | 'bid-only' | 'activation-only' | 'passive';

type ScenarioUser = {
  label: string;
  address: string;
  privateKey?: string;
};

type ScenarioContract = {
  userLabel: string;
  role: Role;
  address: string;
  maxBidWei: string;
  maxActivationCostWei: string;
  enabled: boolean;
  autoActivate: boolean;
};

type ScenarioState = {
  envFile: string;
  rpcUrl: string;
  chainId: number;
  createdAt: string;
  cmaAddress: string;
  cacheManagerAddress: string;
  arbWasmAddress: string;
  arbWasmCacheAddress: string;
  operator: ScenarioUser;
  users: ScenarioUser[];
  contracts: ScenarioContract[];
};

const DEFAULT_SCENARIO_FILE = 'test/tmp/cma-multi-user-scenario.json';
const DEFAULT_ENV_FILE = '.env.vmtest';
const DEFAULT_USER_ESCROW_FUNDING = parseEther('0.005');
const DEFAULT_MAX_BID = 1n;
const DEFAULT_MAX_ACTIVATION_COST = parseEther('0.001');
const PROGRAM_EXPIRED_SELECTOR = '0xc9b12e52';
const PROGRAM_NOT_ACTIVATED_SELECTOR = '0x6f809c4e';

const CMA_ABI = [
  'function insertContract(address,uint256,bool,bool,uint256) payable',
  'function getUserContracts() view returns ((address contractAddress,uint256 maxBid,bool enabled,bool autoActivate,uint256 maxActivationCost)[])',
  'function getUserBalance() view returns (uint256)',
  'function placeBids((address user,address contractAddress)[])',
  'function placeActivations((address user,address contractAddress)[])',
  'event BidPlaced(address indexed user,address indexed contractAddress,uint256 bidAmount,uint256 maxBid,uint256 userBalance)',
  'event BidError(address indexed user,address indexed contractAddress,uint256 bid,string reason)',
  'event ActivationPerformed(address indexed user,address indexed contractAddress,uint16 version,uint256 dataFee,uint256 spent,uint256 refund,uint256 userBalance)',
  'event ActivationError(address indexed user,address indexed contractAddress,uint256 value,string reason)',
];

const CACHE_MANAGER_ABI = [
  'function getMinBid(address program) view returns (uint192)',
];

const ARB_WASM_ABI = [
  'function activateProgram(address program) payable returns (uint16 version,uint256 dataFee)',
  'function programTimeLeft(address program) view returns (uint64)',
];

const ARB_WASM_CACHE_ABI = [
  'function codehashIsCached(bytes32 codehash) view returns (bool)',
];

const ROLE_CONFIG: Record<
  Role,
  {
    enabled: boolean;
    autoActivate: boolean;
    maxBidWei: bigint;
    maxActivationCostWei: bigint;
  }
> = {
  both: {
    enabled: true,
    autoActivate: true,
    maxBidWei: DEFAULT_MAX_BID,
    maxActivationCostWei: DEFAULT_MAX_ACTIVATION_COST,
  },
  'bid-only': {
    enabled: true,
    autoActivate: false,
    maxBidWei: DEFAULT_MAX_BID,
    maxActivationCostWei: 0n,
  },
  'activation-only': {
    enabled: false,
    autoActivate: true,
    maxBidWei: DEFAULT_MAX_BID,
    maxActivationCostWei: DEFAULT_MAX_ACTIVATION_COST,
  },
  passive: {
    enabled: false,
    autoActivate: false,
    maxBidWei: DEFAULT_MAX_BID,
    maxActivationCostWei: 0n,
  },
};

function parseArgs(argv: string[]) {
  const [command = 'report', ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i++;
  }

  return { command, options };
}

function getOption(
  options: Record<string, string | boolean>,
  key: string,
  fallback?: string
) {
  const value = options[key];
  if (typeof value === 'string') return value;
  return fallback;
}

function hasFlag(options: Record<string, string | boolean>, key: string) {
  return options[key] === true;
}

function resolvePath(p: string) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function saveScenario(filePath: string, scenario: ScenarioState) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2));
}

function loadScenario(filePath: string): ScenarioState {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ScenarioState;
}

function loadEnv(envFile: string) {
  dotenv.config({ path: resolvePath(envFile), override: true });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

async function getOperator() {
  const provider = hre.ethers.provider;
  const privateKey = requireEnv('ARBPRE_PK');
  const wallet = new Wallet(privateKey, provider);
  return {
    label: 'operator',
    address: wallet.address,
    privateKey,
    wallet,
  };
}

async function fundWallet(operator: Wallet, address: string, amount: bigint) {
  const tx = await operator.sendTransaction({
    to: address,
    value: amount,
  });
  await tx.wait();
}

async function ensureWalletFunding(
  operator: Wallet,
  wallet: Wallet,
  minimumBalance: bigint
) {
  const balance = await hre.ethers.provider.getBalance(wallet.address);
  if (balance >= minimumBalance) return;

  const missing = minimumBalance - balance;
  const topUp = missing + parseEther('0.01');
  await fundWallet(operator, wallet.address, topUp);
}

async function createAndFundUser2(operator: Wallet) {
  const wallet = Wallet.createRandom().connect(hre.ethers.provider);
  const amount = parseEther('0.05');
  await fundWallet(operator, wallet.address, amount);
  return wallet;
}

function parseRoleList(raw?: string): Role[] {
  const allowed: Role[] = ['both', 'bid-only', 'activation-only', 'passive'];
  if (!raw || raw === 'all') return allowed;
  const roles = raw.split(',').map((item) => item.trim()) as Role[];
  for (const role of roles) {
    if (!allowed.includes(role)) {
      throw new Error(`Unknown role "${role}"`);
    }
  }
  return roles;
}

async function deployCMA() {
  const provider = hre.ethers.provider;
  const operator = await getOperator();
  const factory = await hre.ethers.getContractFactory('CacheManagerAutomation');
  const cacheManagerAddress = hre.ethers.getAddress(requireEnv('CACHE_MANAGER_ADDRESS'));
  const arbWasmCacheAddress = hre.ethers.getAddress(
    requireEnv('ARB_WASM_CACHE_ADDRESS')
  );
  const arbWasmAddress = hre.ethers.getAddress(
    process.env.ARB_WASM_ADDRESS ||
      '0x0000000000000000000000000000000000000071'
  );

  const deployment = await factory.connect(operator.wallet).deploy(
    cacheManagerAddress,
    arbWasmCacheAddress,
    arbWasmAddress
  );
  await deployment.waitForDeployment();

  return {
    provider,
    operator,
    cma: new Contract(await deployment.getAddress(), CMA_ABI, provider),
    cacheManagerAddress,
    arbWasmCacheAddress,
    arbWasmAddress,
  };
}

function deployDummies(envFile: string, amount: number) {
  const command = `bash test/utils/deploy-dummy-wasm.sh -e ${envFile} -i ${amount}`;
  const stdout = execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return stdout
    .replace(/\x1B\[[0-9;]*[mK]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^0x[a-fA-F0-9]{40}$/.test(line));
}

async function registerContracts(
  scenarioUsers: { wallet: Wallet; label: string }[],
  cmaAddress: string,
  contracts: ScenarioContract[]
) {
  for (const user of scenarioUsers) {
    const cma = new Contract(cmaAddress, CMA_ABI, user.wallet);
    const userContracts = contracts.filter((item) => item.userLabel === user.label);

    for (let i = 0; i < userContracts.length; i++) {
      const cfg = userContracts[i];
      const value = i === 0 ? DEFAULT_USER_ESCROW_FUNDING : 0n;
      const tx = await cma.insertContract(
        cfg.address,
        cfg.maxBidWei,
        cfg.enabled,
        cfg.autoActivate,
        cfg.maxActivationCostWei,
        { value }
      );
      await tx.wait();
    }
  }
}

async function getRuntimeContracts(scenario: ScenarioState) {
  const provider = hre.ethers.provider;
  const arbWasm = new Contract(scenario.arbWasmAddress, ARB_WASM_ABI, provider);
  const arbWasmCache = new Contract(
    scenario.arbWasmCacheAddress,
    ARB_WASM_CACHE_ABI,
    provider
  );

  const rows = [];
  for (const item of scenario.contracts) {
    const code = await provider.getCode(item.address);
    const codehash = hre.ethers.keccak256(code);
    const cached = await arbWasmCache.codehashIsCached(codehash);

    let programState = 'unknown';
    try {
      const timeLeft = await arbWasm.programTimeLeft(item.address);
      programState = Number(timeLeft) === 0 ? 'expired(0)' : `active(${timeLeft})`;
    } catch (error) {
      const data = extractRevertData(error);
      if (data.startsWith(PROGRAM_EXPIRED_SELECTOR)) {
        const ageHex = `0x${data.slice(-64)}`;
        programState = `expired(revert:${BigInt(ageHex).toString()})`;
      } else if (data.startsWith(PROGRAM_NOT_ACTIVATED_SELECTOR)) {
        programState = 'not-activated';
      } else {
        programState = `revert(${data || 'unknown'})`;
      }
    }

    rows.push({
      ...item,
      cached,
      programState,
    });
  }

  return rows;
}

function extractRevertData(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as {
    data?: string;
    info?: { error?: { data?: string } };
    shortMessage?: string;
    message?: string;
  };
  if (typeof candidate.data === 'string') return candidate.data;
  if (typeof candidate.info?.error?.data === 'string') return candidate.info.error.data;

  const raw = candidate.shortMessage || candidate.message || '';
  const match = raw.match(/data:\s*"?((0x)?[a-fA-F0-9]+)"?/);
  return match ? (match[1].startsWith('0x') ? match[1] : `0x${match[1]}`) : '';
}

function stringifyArgs(value: unknown): string {
  return JSON.stringify(
    value,
    (_, current) => (typeof current === 'bigint' ? current.toString() : current),
    2
  );
}

async function printReport(scenario: ScenarioState) {
  const provider = hre.ethers.provider;
  const runtimeContracts = await getRuntimeContracts(scenario);

  console.log(`Scenario file: ${scenario.envFile}`);
  console.log(`CMA: ${scenario.cmaAddress}`);
  console.log(`Operator: ${scenario.operator.address}`);

  for (const user of scenario.users) {
    const userWallet = new Wallet(user.privateKey!, provider);
    const cma = new Contract(scenario.cmaAddress, CMA_ABI, userWallet);
    const balance = await cma.getUserBalance();
    console.log(`\nUser ${user.label}: ${user.address}`);
    console.log(`  Escrow balance: ${balance} wei (${formatEther(balance)} ETH)`);

    for (const contractData of runtimeContracts.filter(
      (item) => item.userLabel === user.label
    )) {
      console.log(
        `  - ${contractData.role.padEnd(15)} ${contractData.address} enabled=${contractData.enabled} autoActivate=${contractData.autoActivate} cached=${contractData.cached} state=${contractData.programState}`
      );
    }
  }
}

async function primeActivations(
  scenario: ScenarioState,
  selectedRoles: Role[],
  gasLimit?: bigint
) {
  const provider = hre.ethers.provider;
  const arbWasm = new Contract(scenario.arbWasmAddress, ARB_WASM_ABI, provider);

  for (const user of scenario.users) {
    const wallet = new Wallet(user.privateKey!, provider);
    const targets = scenario.contracts.filter(
      (item) => item.userLabel === user.label && selectedRoles.includes(item.role)
    );

    for (const target of targets) {
      const value = BigInt(target.maxActivationCostWei);
      const activationValue = value > 0n ? value : DEFAULT_MAX_ACTIVATION_COST;
      const tx = await arbWasm
        .connect(wallet)
        .activateProgram(
          target.address,
          gasLimit
            ? { value: activationValue, gasLimit }
            : { value: activationValue }
        );
      const receipt = await tx.wait();
      console.log(
        `prime-activation ${user.label} ${target.role} ${target.address} tx=${receipt?.hash}`
      );
    }
  }
}

async function placeBids(
  scenario: ScenarioState,
  selectedRoles: Role[],
  gasLimit?: bigint
) {
  const provider = hre.ethers.provider;
  const operator = new Wallet(scenario.operator.privateKey!, provider);
  const cma = new Contract(scenario.cmaAddress, CMA_ABI, operator);

  const requests = scenario.contracts
    .filter((item) => selectedRoles.includes(item.role))
    .filter((item) => item.enabled)
    .map((item) => ({
      user: scenario.users.find((user) => user.label === item.userLabel)!.address,
      contractAddress: item.address,
    }));

  const tx = await cma.placeBids(requests, gasLimit ? { gasLimit } : {});
  const receipt = await tx.wait();
  console.log(`place-bids tx=${receipt?.hash}`);

  for (const log of receipt?.logs || []) {
    try {
      const parsed = cma.interface.parseLog(log);
      if (parsed?.name === 'BidPlaced' || parsed?.name === 'BidError') {
        console.log(`  ${parsed.name}: ${stringifyArgs(parsed.args)}`);
      }
    } catch {}
  }
}

async function placeActivations(
  scenario: ScenarioState,
  selectedRoles: Role[],
  gasLimit?: bigint
) {
  const provider = hre.ethers.provider;
  const operator = new Wallet(scenario.operator.privateKey!, provider);
  const cma = new Contract(scenario.cmaAddress, CMA_ABI, operator);

  const requests = scenario.contracts
    .filter((item) => selectedRoles.includes(item.role))
    .filter((item) => item.autoActivate)
    .map((item) => ({
      user: scenario.users.find((user) => user.label === item.userLabel)!.address,
      contractAddress: item.address,
    }));

  const tx = await cma.placeActivations(
    requests,
    gasLimit ? { gasLimit } : {}
  );
  const receipt = await tx.wait();
  console.log(`place-activations tx=${receipt?.hash}`);

  for (const log of receipt?.logs || []) {
    try {
      const parsed = cma.interface.parseLog(log);
      if (
        parsed?.name === 'ActivationPerformed' ||
        parsed?.name === 'ActivationError'
      ) {
        console.log(`  ${parsed.name}: ${stringifyArgs(parsed.args)}`);
      }
    } catch {}
  }
}

function advanceVmTime(vmName: string, hours: number) {
  const command = `multipass exec ${vmName} -- bash -lc 'now=$(date +%s); target=$((now + ${hours}*3600)); sudo date -s "@$target"'`;
  const output = execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(output.trim());
}

async function setupScenario(envFile: string, scenarioFile: string, force: boolean) {
  const scenarioPath = resolvePath(scenarioFile);
  if (fs.existsSync(scenarioPath) && !force) {
    throw new Error(
      `Scenario file already exists at ${scenarioPath}. Use --force to overwrite.`
    );
  }

  const { provider, operator, cma, cacheManagerAddress, arbWasmAddress, arbWasmCacheAddress } =
    await deployCMA();
  const user1Pk = requireEnv('USER_PK');
  const user1 = new Wallet(user1Pk, provider);
  await ensureWalletFunding(operator.wallet, user1, parseEther('0.05'));
  const user2 = await createAndFundUser2(operator.wallet);

  const dummyAddresses = deployDummies(envFile, 8);
  if (dummyAddresses.length < 8) {
    throw new Error(`Expected 8 dummy addresses, got ${dummyAddresses.length}`);
  }

  const roles: Role[] = ['both', 'bid-only', 'activation-only', 'passive'];
  const users = [
    { label: 'user1', wallet: user1, privateKey: user1Pk },
    { label: 'user2', wallet: user2, privateKey: user2.privateKey },
  ];

  const contracts: ScenarioContract[] = [];
  let index = 0;
  for (const user of users) {
    for (const role of roles) {
      const cfg = ROLE_CONFIG[role];
      contracts.push({
        userLabel: user.label,
        role,
        address: dummyAddresses[index++],
        maxBidWei: cfg.maxBidWei.toString(),
        maxActivationCostWei: cfg.maxActivationCostWei.toString(),
        enabled: cfg.enabled,
        autoActivate: cfg.autoActivate,
      });
    }
  }

  await registerContracts(
    users.map((item) => ({ wallet: item.wallet, label: item.label })),
    await cma.getAddress(),
    contracts
  );

  const network = await provider.getNetwork();
  const scenario: ScenarioState = {
    envFile,
    rpcUrl: requireEnv('RPC'),
    chainId: Number(network.chainId),
    createdAt: new Date().toISOString(),
    cmaAddress: await cma.getAddress(),
    cacheManagerAddress,
    arbWasmAddress,
    arbWasmCacheAddress,
    operator: {
      label: 'operator',
      address: operator.address,
      privateKey: operator.privateKey,
    },
    users: users.map((item) => ({
      label: item.label,
      address: item.wallet.address,
      privateKey: item.privateKey,
    })),
    contracts,
  };

  saveScenario(scenarioPath, scenario);
  console.log(`Scenario saved to ${scenarioPath}`);
  await printReport(scenario);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const envFile = getOption(options, 'env', DEFAULT_ENV_FILE)!;
  const scenarioFile = getOption(options, 'scenario-file', DEFAULT_SCENARIO_FILE)!;

  loadEnv(envFile);

  switch (command) {
    case 'setup': {
      await setupScenario(envFile, scenarioFile, hasFlag(options, 'force'));
      return;
    }
    case 'report': {
      const scenario = loadScenario(resolvePath(scenarioFile));
      await printReport(scenario);
      return;
    }
    case 'prime-activations': {
      const scenario = loadScenario(resolvePath(scenarioFile));
      const roles = parseRoleList(getOption(options, 'roles', 'both,activation-only'));
      const gasLimitRaw = getOption(options, 'gas-limit');
      await primeActivations(
        scenario,
        roles,
        gasLimitRaw ? BigInt(gasLimitRaw) : undefined
      );
      return;
    }
    case 'place-bids': {
      const scenario = loadScenario(resolvePath(scenarioFile));
      const roles = parseRoleList(getOption(options, 'roles', 'both,bid-only'));
      const gasLimitRaw = getOption(options, 'gas-limit');
      await placeBids(
        scenario,
        roles,
        gasLimitRaw ? BigInt(gasLimitRaw) : undefined
      );
      return;
    }
    case 'place-activations': {
      const scenario = loadScenario(resolvePath(scenarioFile));
      const roles = parseRoleList(getOption(options, 'roles', 'both,activation-only'));
      const gasLimitRaw = getOption(options, 'gas-limit', '12000000');
      await placeActivations(scenario, roles, BigInt(gasLimitRaw!));
      return;
    }
    case 'advance-vm-time': {
      const vmName = getOption(options, 'vm', 'arbitrum-test')!;
      const hours = Number(getOption(options, 'hours', '25'));
      advanceVmTime(vmName, hours);
      return;
    }
    default:
      throw new Error(
        `Unknown command "${command}". Expected one of: setup, report, prime-activations, place-bids, place-activations, advance-vm-time`
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
