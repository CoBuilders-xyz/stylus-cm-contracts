// monitorEvents.ts
import { ethers, EventFragment } from 'ethers';
import contractABI from '../../artifacts/TestCMLoop.sol/TestCMLoop.json';

// Define the provider and contract address
const provider = new ethers.JsonRpcProvider('http://localhost:8547');
const contractAddress = '0x995cC147259f26ae82b31a0d3d50E4Ae24d76b0f';
// Replace with your contract address

// Empty if you want to listen to all events
const abi = contractABI.abi; // Explicitly define the type as string array

// Create a contract instance
const contract = new ethers.Contract(contractAddress, abi, provider);

// Listen for any event
// contract.on('*', (event) => {
//   const log = event.log;
//   const data = log.data;
//   const topics = log.topics;
//   const address = log.address;

//   console.log('--------------------------------');
//   console.log(`Topics: ${topics}`);
//   console.log(`Address: ${address}`);
//   console.log(`Data: ${data}`);
//   console.log('--------------------------------');
// });

// Keep the script running
console.log('Listening for all events...');

contract.interface.fragments.forEach((fragment) => {
  if (fragment.type === 'event') {
    const eventFragment = fragment as EventFragment; // Type assertion to EventFragment
    contract.on(eventFragment.name, (...args) => {
      // console.log(args);
      console.log(
        `Event: ${eventFragment.name} | Value: ${args[0]} | Timestamp: ${args[1]}`
      );
      console.log('--------------------------------');
    });
  }
});
