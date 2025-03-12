#!/bin/bash
# Run from repo root folder

source .env

# Move to contract folder
cd test/mock-wasm-contracts/mock-contract

# Define the Rust source file
CLEAN_RUST_FILE="src/clean_lib.rs"
RUST_FILE="src/lib.rs"
ITERATIONS=${1:-5}  # Set the number of iterations

# Guarantee cleen start
cp $CLEAN_RUST_FILE $RUST_FILE
DUMMY_OLD="dummy"
for ((i=1; i<=ITERATIONS; i++)); do
    RANDOM_NUM=$(( RANDOM % 100000 ))  # Generate a random number
    DUMMY_NEW="dummy_${RANDOM_NUM}"

    # Replace function name in Rust file
    sed -i "s/pub fn ${DUMMY_OLD}(/pub fn ${DUMMY_NEW}(/g" "$RUST_FILE"

    # Compile and deploy the contract
    CONTRACT_ADDRESS=$(cargo stylus deploy --private-key $ARBPRE_PK --no-verify --endpoint=$RPC 2>/dev/null | grep "deployed code at address" | awk '{print $5}')

    echo "$CONTRACT_ADDRESS"
    
    DUMMY_OLD=$DUMMY_NEW
done
# # Restore the original function name
cp $CLEAN_RUST_FILE $RUST_FILE
