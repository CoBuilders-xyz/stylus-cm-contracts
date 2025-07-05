import { promises as fs } from 'fs';
import path from 'path';

interface ArtifactData {
  contractName: string;
  abi: any[];
  bytecode: string;
}

async function extractABIs() {
  console.log('🔍 Extracting ABIs from compiled contracts...');

  const artifactsPath = path.join(__dirname, '../../build/artifacts/contracts');
  const abiOutputPath = path.join(__dirname, '../../abis/generated');

  // Ensure output directory exists
  await fs.mkdir(abiOutputPath, { recursive: true });

  // Process core contracts
  const coreContracts = ['CacheManagerAutomation', 'BiddingEscrow'];

  for (const contractName of coreContracts) {
    try {
      const contractPath = path.join(
        artifactsPath,
        'core',
        `${contractName}.sol`,
        `${contractName}.json`
      );
      const artifactData: ArtifactData = JSON.parse(
        await fs.readFile(contractPath, 'utf8')
      );

      const abi = artifactData.abi;

      // Generate standalone ABI file
      const abiFileName = `${contractName}.abi.json`;
      const abiFilePath = path.join(abiOutputPath, abiFileName);

      await fs.writeFile(abiFilePath, JSON.stringify(abi, null, 2), 'utf8');

      console.log(`✅ Generated ABI for ${contractName}`);
    } catch (error) {
      console.warn(`⚠️  Could not generate ABI for ${contractName}:`, error);
    }
  }

  // Process interface contracts
  const interfaceContracts = [
    'ICacheManagerAutomation',
    'ICacheManager',
    'IArbWasmCache',
  ];

  for (const contractName of interfaceContracts) {
    try {
      let contractPath: string;

      if (contractName === 'ICacheManagerAutomation') {
        contractPath = path.join(
          artifactsPath,
          'interfaces',
          `${contractName}.sol`,
          `${contractName}.json`
        );
      } else {
        contractPath = path.join(
          artifactsPath,
          'interfaces',
          'IExternalContracts.sol',
          `${contractName}.json`
        );
      }

      const artifactData: ArtifactData = JSON.parse(
        await fs.readFile(contractPath, 'utf8')
      );

      const abi = artifactData.abi;

      // Generate standalone ABI file
      const abiFileName = `${contractName}.abi.json`;
      const abiFilePath = path.join(abiOutputPath, abiFileName);

      await fs.writeFile(abiFilePath, JSON.stringify(abi, null, 2), 'utf8');

      console.log(`✅ Generated ABI for ${contractName}`);
    } catch (error) {
      console.warn(`⚠️  Could not generate ABI for ${contractName}:`, error);
    }
  }

  console.log('🎉 ABI extraction completed!');
}

async function main() {
  try {
    await extractABIs();
  } catch (error) {
    console.error('❌ Error extracting ABIs:', error);
    process.exit(1);
  }
}

main();
