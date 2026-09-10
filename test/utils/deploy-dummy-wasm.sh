#!/bin/bash
# Run from repo root folder
set -euo pipefail

# Default values
ENV_FILE=".env"
ITERATIONS=5
MOCK_CONTRACT_DIR="test/utils/mock-wasm-contracts/mock-contract"

# Show usage information
function show_usage {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -e, --env FILE      Path to the environment file (default: .env)"
    echo "  -i, --iterations N  Number of iterations (default: 5)"
    echo "  -h, --help          Show this help message"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        -i|--iterations)
            ITERATIONS="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file '$ENV_FILE' not found!"
    exit 1
fi

# Source the environment file
source "$ENV_FILE"

REPO_ROOT="$(pwd)"

if [ -z "${ARBPRE_PK:-}" ] || [ -z "${RPC:-}" ]; then
    echo "Error: ARBPRE_PK and RPC must be set in '$ENV_FILE'"
    exit 1
fi

if ! command -v cargo-stylus >/dev/null 2>&1; then
    echo "Error: cargo-stylus is not installed."
    echo "Install it with: cargo install cargo-stylus"
    exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
    echo "Error: rustup is not installed. See https://rustup.rs/"
    exit 1
fi

# mock-contract/rust-toolchain.toml pins the channel (e.g. 1.83.0); install wasm std for that toolchain
(
    cd "$MOCK_CONTRACT_DIR"
    if ! rustup target list --installed | grep -q '^wasm32-unknown-unknown$'; then
        echo "Installing wasm32-unknown-unknown for $(rustup show active-toolchain 2>/dev/null | head -1)..."
        rustup target add wasm32-unknown-unknown
    fi
)

# Move to contract folder
cd "$MOCK_CONTRACT_DIR"

# Define the Rust source file
CLEAN_RUST_FILE="src/clean_lib.rs"
RUST_FILE="src/lib.rs"

# Guarantee clean start
cp $CLEAN_RUST_FILE $RUST_FILE
DUMMY_OLD="dummy"

# Array to store deployed contract addresses
declare -a CONTRACT_ADDRESSES

echo "Deploying $ITERATIONS dummy contracts..."

for ((i=1; i<=ITERATIONS; i++)); do
    RANDOM_NUM=$(( RANDOM % 100000 ))  # Generate a random number
    DUMMY_NEW="dummy_${RANDOM_NUM}"

    # Replace function name in Rust file
    perl -i -pe "s/pub fn ${DUMMY_OLD}\\(/pub fn ${DUMMY_NEW}\\(/g" "$RUST_FILE"

    # Compile and deploy the contract
    if ! DEPLOY_OUTPUT=$(cargo stylus deploy --private-key "$ARBPRE_PK" --no-verify --no-activate --endpoint="$RPC" 2>&1); then
        echo "$DEPLOY_OUTPUT"
        echo "Error: cargo stylus deploy failed on iteration $i"
        exit 1
    fi
    echo "$DEPLOY_OUTPUT"
    CLEAN_DEPLOY_OUTPUT=$(echo "$DEPLOY_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
    CONTRACT_ADDRESS=$(echo "$CLEAN_DEPLOY_OUTPUT" | sed -nE 's/.*(Deploying program to address|deployed code at address):? (0x[0-9a-fA-F]{40}).*/\2/p' | tail -n 1)

    if [ -z "$CONTRACT_ADDRESS" ]; then
        echo "Error: could not parse deployed contract address from cargo stylus output"
        exit 1
    fi

    echo "$CONTRACT_ADDRESS"
    CONTRACT_ADDRESSES+=("$CONTRACT_ADDRESS")
    
    DUMMY_OLD=$DUMMY_NEW
done

# Restore the original function name
cp $CLEAN_RUST_FILE $RUST_FILE

# Return to the root directory
cd "$REPO_ROOT"

# Create addresses.txt directory if it doesn't exist
ADDRESSES_OUTPUT_FILE="test/tmp/addresses.txt"
mkdir -p "$(dirname "$ADDRESSES_OUTPUT_FILE")"

# Append addresses to the addresses.txt file
echo "" >> "$ADDRESSES_OUTPUT_FILE"
for addr in "${CONTRACT_ADDRESSES[@]}"; do
    if [ -n "$addr" ]; then  # Only add non-empty addresses
        # Clean the address - remove any ANSI color codes
        clean_addr=$(echo "$addr" | sed 's/\x1b\[[0-9;]*m//g')
        
        # Check if address already exists in the file to avoid duplicates
        if ! grep -q "$clean_addr" "$ADDRESSES_OUTPUT_FILE"; then
            echo "$clean_addr" >> "$ADDRESSES_OUTPUT_FILE"
            echo "Added address $clean_addr to $ADDRESSES_OUTPUT_FILE"
        else
            echo "Address $clean_addr already exists in $ADDRESSES_OUTPUT_FILE"
        fi
    fi
done

echo "All contracts deployed and addresses saved to $ADDRESSES_OUTPUT_FILE!"
