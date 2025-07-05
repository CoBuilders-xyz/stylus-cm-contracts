import { promises as fs } from 'fs';
import path from 'path';
import { ethers } from 'ethers';

interface ABIVerificationResult {
  contractName: string;
  filePath: string;
  isValid: boolean;
  error?: string;
}

async function verifyABI(abiPath: string): Promise<ABIVerificationResult> {
  const contractName = path.basename(abiPath, '.json');

  try {
    const abiContent = await fs.readFile(abiPath, 'utf8');
    const parsedContent = JSON.parse(abiContent);

    let abi: any[];

    // Handle different ABI formats
    if (Array.isArray(parsedContent)) {
      // Plain ABI array format
      abi = parsedContent;
    } else if (parsedContent.abi && Array.isArray(parsedContent.abi)) {
      // Artifact format with .abi property
      abi = parsedContent.abi;
    } else {
      return {
        contractName,
        filePath: abiPath,
        isValid: false,
        error: 'ABI is not an array and does not contain an abi property',
      };
    }

    // Try to create an interface from the ABI
    const iface = new ethers.Interface(abi);

    // Check for required functions/events
    const functions = iface.fragments.filter((f) => f.type === 'function');
    const events = iface.fragments.filter((f) => f.type === 'event');

    console.log(`📋 ${contractName}:`);
    console.log(`   Functions: ${functions.length}`);
    console.log(`   Events: ${events.length}`);

    return {
      contractName,
      filePath: abiPath,
      isValid: true,
    };
  } catch (error) {
    return {
      contractName,
      filePath: abiPath,
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function verifyAllABIs() {
  console.log('🔍 Verifying ABI compatibility...');

  const abiDirs = [
    path.join(__dirname, '../../abis/generated'),
    path.join(__dirname, '../../abis/external'),
  ];

  const results: ABIVerificationResult[] = [];

  for (const dir of abiDirs) {
    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(dir, file);
          const result = await verifyABI(filePath);
          results.push(result);
        }
      }
    } catch (error) {
      console.log(`⚠️  Directory ${dir} not found or inaccessible`);
    }
  }

  // Summary
  const validABIs = results.filter((r) => r.isValid);
  const invalidABIs = results.filter((r) => !r.isValid);

  console.log('\n📊 Verification Summary:');
  console.log(`✅ Valid ABIs: ${validABIs.length}`);
  console.log(`❌ Invalid ABIs: ${invalidABIs.length}`);

  if (invalidABIs.length > 0) {
    console.log('\n❌ Invalid ABIs:');
    invalidABIs.forEach((result) => {
      console.log(`   ${result.contractName}: ${result.error}`);
    });
  }

  return results;
}

async function main() {
  try {
    await verifyAllABIs();
  } catch (error) {
    console.error('❌ Error verifying ABIs:', error);
    process.exit(1);
  }
}

main();
