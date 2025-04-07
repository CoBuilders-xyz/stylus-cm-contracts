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
cd test/mock-wasm-contracts/mock-contract

# Define the Rust source file
CLEAN_RUST_FILE="src/clean_lib.rs"
RUST_FILE="src/lib.rs"

# Guarantee clean start
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
# Restore the original function name
cp $CLEAN_RUST_FILE $RUST_FILE
