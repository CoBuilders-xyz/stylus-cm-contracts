CMA_ADDRESS=0x7AF2571dC86B7608DDc6AcfBf01B2BE6F0EfC244 # Local
CM_ADD=0x0f1f89aaf1c6fdb7ff9d361e4388f5f3997f12a8 # Local
RPC=http://localhost:8547
DUMMY=0xc67dd16bdaaabf4a54f42aece6100a61526b2220 # Local

CMA_ADDRESS=0xB6059FBd316CB7C6F5b7CF0a62a9a113700A9069 # Sepolia
CM_ADD=0x0c9043d042ab52cfa8d0207459260040cca54253 # Sepolia
RPC=https://arb-sepolia.g.alchemy.com/v2/uEQNrf1PSgpUcyWrvB_UjFl5hTWATpEz # Sepolia
DUMMY=0x7817a8dca08e6e9b61226cf4924aa19c30ec3aef # Sepolia


ARB_WASM_CACHE_ADDRESS=0x0000000000000000000000000000000000000072
USER_ADDRESS=0x39DaE6A77A5165598aEB84cAe96Aea0A2215bCa8
USER_PK=0x6ec659638309dd9b18ded7cab5a3c70b0ff30ae72aa3e6440ea3d79ef375933c
ADMIN_PK=0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
L2OWNER_PK=0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4c

cast send $CMA_ADDRESS "insertContract(address, uint256, bool)" $DUMMY $(cast to-wei 0.000001) true --value  $(cast to-wei 0.00001) --private-key $USER_PK --rpc-url $RPC        

cast send $CMA_ADDRESS "updateContract(address, uint256, bool)" $DUMMY $(cast to-wei 0.001) true --private-key $USER_PK --rpc-url $RPC       

cast send $CMA_ADDRESS "removeAllContracts()" --private-key $USER_PK --rpc-url $RPC       

# User Contracts

# struct ContractConfig {
#     address contractAddress;
#     uint256 maxBid;
#     uint256 lastBid;
#     bool enabled;
# }
cast call $CMA_ADDRESS "getUserContracts()(tuple(address,uint256,uint256,bool)[])" --private-key $USER_PK --rpc-url $RPC

#Is contract cached
CONTRACT_ADDRESS=0x11B57FE348584f042E436c6Bf7c3c3deF171de49
BYTECODE=$(cast code $CONTRACT_ADDRESS --rpc-url $RPC)
CODEHASH=$(cast keccak $BYTECODE)
cast call $ARB_WASM_CACHE_ADDRESS "codehashIsCached(bytes32)(bool)" $CODEHASH --private-key $USER_PK --rpc-url $RPC


# User Balance
cast call $CMA_ADDRESS "getUserBalance()(uint256)" --private-key $USER_PK --rpc-url $RPC

# Check contract balance
cast balance $CMA_ADDRESS --rpc-url $RPC

# Evict All
 cast send $CMA_ADDRESS "evictAll()" --rpc-url $RPC --private-key $L2OWNER_PK 

# Place a bid directly to CM
# 0x518c6999d2187548a99686554aa7fe1cb642ecba
# 0xc67dd16bdaaabf4a54f42aece6100a61526b2220
# 0x9aa597ce9b11f8708e97caa4eef17535d889d858
# 0x63184480e2911f307a63624161cc14e73584ae14
CONTRACT=0x7817A8DcA08e6e9B61226cf4924Aa19C30EC3aeF
cast send $CM_ADD "placeBid(address)" $CONTRACT --rpc-url $RPC --value $(cast to-wei 0) --private-key $USER_PK

# Place Several Bids
CONTRACT1=0x841118047F42754332d0Ad4db8a2893761dD7F5d
CONTRACT2=0x9fE335eBaf31c422F994bf21e79dE5A2D70859d6
CONTRACT3=0x8e1308925a26cb5cF400afb402d67B3523473379
CONTRACT4=0xDcfEDbe9Fe4627E8bBd50eDc97b9b5127E203300
cast send $CMA_ADDRESS "placeBids((address,address)[])" "[($USER_ADDRESS,$CONTRACT1),($USER_ADDRESS,$CONTRACT2),($USER_ADDRESS,$CONTRACT3),($USER_ADDRESS,$CONTRACT4)]" --rpc-url $RPC --private-key $USER_PK

# Place One Bid
CONTRACT=0xF5FfD11A55AFD39377411Ab9856474D2a7Cb697e
cast send $CMA_ADDRESS "placeBids((address,address)[])" "[($USER_ADDRESS,$CONTRACT)]" --rpc-url $RPC --private-key $USER_PK

# Raw contracts data:
cast call $CMA_ADDRESS "getContracts()((address,(address,uint256,bool)[])[])" --rpc-url $RPC --json | jq -r '.[0]'

# Formatted for readability:
cast call $CMA_ADDRESS "getContracts()((address,(address,uint256,bool)[])[])" --rpc-url $RPC --json | jq -r '.[0]' | tr ',' '\n' | sed 's/\[(/[\n(/g; s/)\]/)\n]/g'
