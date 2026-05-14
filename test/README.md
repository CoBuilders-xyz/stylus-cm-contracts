# CacheManagerAutomation Local Scenario

This is a simple step-by-step guide to run the local 8-contract scenario.

## What this scenario does

It creates:

- 2 users
- 4 dummy Stylus contracts per user
- 8 contracts total

Per user, the 4 contracts are:

- `both`: cache + activation enabled
- `bid-only`: cache only
- `activation-only`: activation only
- `passive`: neither

## Files

- Scenario script: [test/scenarios/cma-multi-user-exercise.ts](/media/ifq/storage-linux/cobuilders.xyz/repos/arbitrum/stylus-cm-deploy/submodules/stylus-cm-contracts/test/scenarios/cma-multi-user-exercise.ts)
- VM bootstrap: [test/utils/bootstrap-nitro-testnode-vm.sh](/media/ifq/storage-linux/cobuilders.xyz/repos/arbitrum/stylus-cm-deploy/submodules/stylus-cm-contracts/test/utils/bootstrap-nitro-testnode-vm.sh)
- Dummy deploy helper: [test/utils/deploy-dummy-wasm.sh](/media/ifq/storage-linux/cobuilders.xyz/repos/arbitrum/stylus-cm-deploy/submodules/stylus-cm-contracts/test/utils/deploy-dummy-wasm.sh)

## Prerequisites

You need:

- a Nitro test node
- an RPC reachable from your host
- the repo env file [`.env.vmtest`](/media/ifq/storage-linux/cobuilders.xyz/repos/arbitrum/stylus-cm-deploy/submodules/stylus-cm-contracts/.env.vmtest)

## Step 0: Start a local Nitro VM

If you do not already have a local Nitro test node:

```bash
./test/utils/bootstrap-nitro-testnode-vm.sh --mount-source "$PWD"
```

If you want the full node up immediately:

```bash
./test/utils/bootstrap-nitro-testnode-vm.sh --mount-source "$PWD" --run-up
```

If your RPC is only exposed inside the VM, you can forward it with `socat`.

Example:

```bash
multipass exec arbitrum-test -- sudo apt-get update
```

```bash
multipass exec arbitrum-test -- sudo apt-get install -y socat
```

```bash
multipass exec arbitrum-test -- bash -lc "nohup socat TCP-LISTEN:8549,fork,bind=0.0.0.0 TCP:127.0.0.1:8547 >/tmp/socat-8549.log 2>&1 &"
```

Check the IP:

```bash
multipass info arbitrum-test
```

Check the RPC:

```bash
cast chain-id --rpc-url http://VM-IP:8549
```

## Step 1: Load the env file

The repo already includes `.env.vmtest`.

```bash
set -a
source .env.vmtest
set +a
```

If your VM IP is different, edit this line first:

```bash
RPC=http://10.238.114.146:8549
```

and this line:

```bash
ARB_LOCAL_RPC=http://10.238.114.146:8549
```

## Step 2: Create the 8-contract scenario

```bash
npm run scenario:multi-user -- \
  setup \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json \
  --force
```

This will:

- deploy a fresh `CacheManagerAutomation`
- create/fund 2 users
- deploy 8 dummy Stylus contracts
- register all 8 contracts in CMA

## Step 3: Print the initial state

```bash
npm run scenario:multi-user -- \
  report \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json
```

Expected idea:

- every contract starts as `not-activated`
- nothing is cached yet

## Step 4: Activate the contracts that will participate

`placeBids` only works for programs that have already been activated at least once.

Run:

```bash
npm run scenario:multi-user -- \
  prime-activations \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json \
  --roles both,bid-only,activation-only
```

This activates:

- `both`
- `bid-only`
- `activation-only`

It does not touch:

- `passive`

## Step 5: Check state again

```bash
npm run scenario:multi-user -- \
  report \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json
```

Expected idea:

- `both`, `bid-only`, `activation-only` should be `active(...)`
- `passive` should still be `not-activated`

## Step 6: Run the cache flow

```bash
npm run scenario:multi-user -- \
  place-bids \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json \
  --roles both,bid-only
```

This targets only the 4 cache-enabled contracts.

## Step 7: Check state after bids

```bash
npm run scenario:multi-user -- \
  report \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json
```

Expected idea:

- `both` should be `cached=true`
- `bid-only` should be `cached=true`
- `activation-only` should still be `cached=false`
- `passive` should still be untouched

## Step 8: Configure short expiry

Before advancing time, configure Nitro so Stylus programs expire quickly.

Run:

```bash
cast send 0x0000000000000000000000000000000000000070 \
  "setWasmKeepaliveDays(uint16)" 0 \
  --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 \
  --rpc-url "$RPC"
```

```bash
cast send 0x0000000000000000000000000000000000000070 \
  "setWasmExpiryDays(uint16)" 1 \
  --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 \
  --rpc-url "$RPC"
```

Without this step, moving the VM clock by `25h` may not be enough.

## Step 9: Advance time

If you are using Multipass:

```bash
npm run scenario:multi-user -- \
  advance-vm-time \
  --env .env.vmtest \
  --hours 25
```

Then force a new block:

```bash
cast send 0x3f1Eae7D46d88F08fc2F8ed27FCb2AB183EB2d0E \
  --value 1 \
  --private-key 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659 \
  --rpc-url http://10.238.114.146:8549
```

## Step 10: Check which contracts expired

```bash
npm run scenario:multi-user -- \
  report \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json
```

Expected idea:

- active contracts should now show `expired(...)`
- `passive` should still be `not-activated`

## Step 11: Run the activation flow

Use a high gas limit.

```bash
npm run scenario:multi-user -- \
  place-activations \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json \
  --roles both,activation-only \
  --gas-limit 12000000
```

This targets only the 4 auto-activate contracts.

## Step 12: Check final state

```bash
npm run scenario:multi-user -- \
  report \
  --env .env.vmtest \
  --scenario-file test/tmp/cma-multi-user-scenario.json
```

Expected idea:

- `both` should be active again
- `activation-only` should be active again
- `bid-only` should stay expired
- `passive` should stay `not-activated`

## Optional: Skip-by-balance scenario

To test partial execution:

1. empty one user's escrow
2. expire contracts again
3. run `place-activations`

Example:

```bash
cast send 0xBd7f7c83BdBABfD65a98c6D2AFc9261F3d2Eb03B \
  "withdrawBalance()" \
  --private-key 0x6ec659638309dd9b18ded7cab5a3c70b0ff30ae72aa3e6440ea3d79ef375933c \
  --rpc-url http://10.238.114.146:8549
```

Then repeat:

- Step 9
- Step 10
- Step 11
- Step 12

Expected idea:

- the empty user is skipped
- the funded user is reactivated
- the batch still succeeds

## Notes

- `placeBids` requires first activation
- `placeActivations` is gas-heavy
- generated files are written under `test/tmp/`
