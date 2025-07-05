#!/bin/bash
# Run from repo root folder
# This script places bids for a list of contract addresses

# Default values
ENV_FILE=".env"
MIN_BID=0.0001
MAX_BID=0.001
ADDRESSES_FILE=""
DEBUG=false

# Show usage information
function show_usage {
    echo "Usage: $0 [OPTIONS] [ADDRESSES...]"
    echo "Options:"
    echo "  -e, --env FILE      Path to the environment file (default: .env)"
    echo "  -f, --file FILE     File containing contract addresses (one per line)"
    echo "  --min-bid AMOUNT    Minimum bid amount in ETH (default: 0.0001)"
    echo "  --max-bid AMOUNT    Maximum bid amount in ETH (default: 0.001)"
    echo "  -d, --debug         Enable debug mode with more verbose output"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "You can provide addresses directly as arguments or in a file with -f option"
    exit 1
}

# Parse command line arguments
ADDRESSES=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        -f|--file)
            ADDRESSES_FILE="$2"
            shift 2
            ;;
        --min-bid)
            MIN_BID="$2"
            shift 2
            ;;
        --max-bid)
            MAX_BID="$2"
            shift 2
            ;;
        -d|--debug)
            DEBUG=true
            shift
            ;;
        -h|--help)
            show_usage
            ;;
        0x*)
            # This is an address
            ADDRESSES+=("$1")
            shift
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

# Check if required environment variables are set
if [ -z "$ARBPRE_PK" ]; then
    echo "Error: ARBPRE_PK environment variable not set in $ENV_FILE"
    exit 1
fi

if [ -z "$RPC" ]; then
    echo "Error: RPC environment variable not set in $ENV_FILE"
    exit 1
fi

if [ -z "$CACHE_MANAGER_ADDRESS" ]; then
    echo "Error: CACHE_MANAGER_ADDRESS environment variable not set in $ENV_FILE"
    exit 1
fi

if [ -z "$ARB_WASM_CACHE_ADDRESS" ]; then
    echo "Error: ARB_WASM_CACHE_ADDRESS environment variable not set in $ENV_FILE"
    exit 1
fi

# Read addresses from file if provided
if [ -n "$ADDRESSES_FILE" ]; then
    if [ ! -f "$ADDRESSES_FILE" ]; then
        echo "Error: Addresses file '$ADDRESSES_FILE' not found!"
        exit 1
    fi
    
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines and comments
        if [[ -n "$line" && ! "$line" =~ ^# ]]; then
            # Extract the address (in case there's additional text on the line)
            addr=$(echo "$line" | grep -o '0x[0-9a-fA-F]\{40\}')
            if [ -n "$addr" ]; then
                ADDRESSES+=("$addr")
            fi
        fi
    done < "$ADDRESSES_FILE"
fi

# Check if we have any addresses
if [ ${#ADDRESSES[@]} -eq 0 ]; then
    echo "Error: No contract addresses provided!"
    show_usage
fi

echo "Found ${#ADDRESSES[@]} contract addresses. Now checking cache status and placing bids..."


# Place random bids for each contract
for i in "${!ADDRESSES[@]}"; do
    CONTRACT_ADDRESS="${ADDRESSES[$i]}"
    
    echo "Processing contract $((i+1))/${#ADDRESSES[@]}: $CONTRACT_ADDRESS"
    
    # Get the code hash of the contract using standard Ethereum approach
    echo "  Getting code hash..."
    # Get the bytecode
    BYTECODE=$(cast code --rpc-url $RPC $CONTRACT_ADDRESS)
    if [ -z "$BYTECODE" ] || [ "$BYTECODE" = "0x" ]; then
        echo "  Warning: No bytecode found for contract at $CONTRACT_ADDRESS. Skipping..."
        echo "[$(date)] No bytecode found for $CONTRACT_ADDRESS" >> "$LOG_FILE"
        continue
    fi
    
    # Calculate keccak256 hash of the bytecode
    CODE_HASH=$(cast keccak256 $BYTECODE)
    echo "  Code hash: $CODE_HASH"
    
    # Check if the contract is cached
    echo "  Checking if contract is cached..."
    IS_CACHED=""
    if $DEBUG; then
        IS_CACHED=$(cast call --rpc-url $RPC $ARB_WASM_CACHE_ADDRESS "codehashIsCached(bytes32)(bool)" $CODE_HASH 2>&1)
    else
        IS_CACHED=$(cast call --rpc-url $RPC $ARB_WASM_CACHE_ADDRESS "codehashIsCached(bytes32)(bool)" $CODE_HASH 2>/dev/null)
    fi
    
    if [[ "$IS_CACHED" == *"error"* ]]; then
        echo "  Error checking cache status: $IS_CACHED"
        echo "[$(date)] Error checking cache for $CONTRACT_ADDRESS: $IS_CACHED" >> "$LOG_FILE"
        continue
    fi

    if [ "$IS_CACHED" != "true" ]; then
        echo "  Contract is not cached. Attempting to cache..."
        
        CACHE_RESULT=""
        if $DEBUG; then
            CACHE_RESULT=$(cast send --private-key $ARBPRE_PK --rpc-url $RPC $ARB_WASM_CACHE_ADDRESS "cacheProgram(address)" $CONTRACT_ADDRESS 2>&1)
        else
            CACHE_RESULT=$(cast send --private-key $ARBPRE_PK --rpc-url $RPC $ARB_WASM_CACHE_ADDRESS "cacheProgram(address)" $CONTRACT_ADDRESS 2>/dev/null)
        fi
        
        if [[ "$CACHE_RESULT" == *"error"* ]]; then
            echo "  Warning: Failed to cache contract. Continuing anyway..."
            echo "[$(date)] Failed to cache $CONTRACT_ADDRESS: $CACHE_RESULT" >> "$LOG_FILE"
        else
            echo "  Contract cached successfully."
        fi
    else
        echo "  Contract is already cached."
    fi
    
    # Generate a random bid amount between MIN_BID and MAX_BID
    # We multiply by 10000 to work with integers, then divide by 10000 to get 4 decimal places
    MIN_BID_INT=$(echo "$MIN_BID * 10000" | bc | cut -d. -f1)
    MAX_BID_INT=$(echo "$MAX_BID * 10000" | bc | cut -d. -f1)
    RANGE=$((MAX_BID_INT - MIN_BID_INT + 1))
    RANDOM_BID_INT=$((RANDOM % RANGE + MIN_BID_INT))
    RANDOM_BID=$(echo "scale=4; $RANDOM_BID_INT / 10000" | bc)
    
    echo "  Placing bid of $RANDOM_BID ETH..."
    
    # Place the bid using cast
    BID_RESULT=""
    if $DEBUG; then
        BID_RESULT=$(cast send $CACHE_MANAGER_ADDRESS "placeBid(address)" $CONTRACT_ADDRESS --rpc-url $RPC --value $(cast to-wei $RANDOM_BID) --private-key $ARBPRE_PK 2>&1)
    else
        BID_RESULT=$(cast send $CACHE_MANAGER_ADDRESS "placeBid(address)" $CONTRACT_ADDRESS --rpc-url $RPC --value $(cast to-wei $RANDOM_BID) --private-key $ARBPRE_PK 2>/dev/null)
    fi
    
    if [[ "$BID_RESULT" == *"error"* ]]; then
        echo "  Error placing bid: $BID_RESULT"
    else
        echo "  Bid placed successfully!"
    fi
    
    # Add a small delay between transactions
    sleep 2
    echo ""
done

echo "All operations completed. Check $LOG_FILE for any errors." 