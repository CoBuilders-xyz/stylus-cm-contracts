# L2 Owner
cast send 0x0000000000000000000000000000000000000070 "setWasmExpiryDays(uint16 _days)" 1 --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC

cast send 0x0000000000000000000000000000000000000070 "setWasmKeepaliveDays(uint16 _days)" 0 --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC

cast call $ARBWASM "programTimeLeft(address)(uint64)" $CONTRACT --rpc-url $RPC


cast send $ARBWASM "activateProgram(address)" $CONTRACT --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC --value 4516349442464640


cast send $ARBWASM "codehashKeepalive(address)" $CONTRACT --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC 


# Testing Sequence changeing host time

CONTRACT=0x11b57fe348584f042e436c6bf7c3c3def171de49

# Set L2 Expiration time to 0 (force expiration)
cast send 0x0000000000000000000000000000000000000070 "setWasmExpiryDays(uint16 _days)" 1 --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC

# Check time left
cast call $ARBWASM "programTimeLeft(address)(uint64)" $CONTRACT --rpc-url $RPC

# Time Travel
sudo timedatectl set-ntp false
sudo date -s "+25 hours"

#Restart docker to reload time

# Send a TX to move
cast send $USER_ADD --private-key $ARBPRE_PK --rpc-url $RPC

#Check time left
cast call $ARBWASM "programTimeLeft(address)(uint64)" $CONTRACT --rpc-url $RPC

# Call activate program now that the program is expired, we can activate it. For some reason it requires a value
cast send $ARBWASM "activateProgram(address)" $CONTRACT --private-key 0xdc04c5399f82306ec4b4d654a342f40e2e0620fe39950d967e1e574b32d4dd36 --rpc-url $RPC --value 64226033567176

# Verify time left
cast call $ARBWASM "programTimeLeft(address)(uint64)" $CONTRACT --rpc-url $RPC

# Move the blockchain 
cast send $USER_ADD --private-key $ARBPRE_PK --rpc-url $RPC

# Testing Sequence inside VM

# Create Virtual Machine
multipass launch --name arbitrum-test --memory 3G --disk 20G --cpus 2 jammy
multipass shell arbitrum-test

# Install Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Replace $(. /etc/os-release; echo "$VERSION_CODENAME") with your codename if needed (jammy)
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release; echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
exit

# reconnect to the VM to load user into user group.
multipass mount ./ arbitrum-test:/home/ubuntu/project
