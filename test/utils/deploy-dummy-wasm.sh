#!/bin/bash
# Run from repo root folder

# Default values
ENV_FILE=".env"
ITERATIONS=5

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

# Move to contract folder
cd test/utils/mock-wasm-contracts/mock-contract

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
    CONTRACT_ADDRESS=$(cargo stylus deploy --private-key $ARBPRE_PK --no-verify --endpoint=$RPC 2>/dev/null | grep "deployed code at address" | awk '{print $5}')

    echo "$CONTRACT_ADDRESS"
    CONTRACT_ADDRESSES+=("$CONTRACT_ADDRESS")
    
    DUMMY_OLD=$DUMMY_NEW
done

# Restore the original function name
cp $CLEAN_RUST_FILE $RUST_FILE

# Return to the root directory
cd ../../../

# Create addresses.txt directory if it doesn't exist
ADDRESSES_OUTPUT_FILE="test/utils/addresses.txt"
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
