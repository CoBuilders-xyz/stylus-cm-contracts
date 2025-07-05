import { runTypeChain, glob } from 'typechain';
import path from 'path';

async function generateTypes() {
  console.log('🔍 Generating TypeScript types from ABIs...');

  const cwd = process.cwd();
  const allFiles = glob(cwd, [`${cwd}/abis/**/*.json`]);

  await runTypeChain({
    cwd,
    filesToProcess: allFiles,
    allFiles,
    outDir: path.join(cwd, 'build/typechain-types'),
    target: 'ethers-v6',
    flags: {
      alwaysGenerateOverloads: false,
      discriminateTypes: false,
      tsNocheck: false,
      environment: 'hardhat',
    },
  });

  console.log('🎉 TypeScript types generation completed!');
}

async function main() {
  try {
    await generateTypes();
  } catch (error) {
    console.error('❌ Error generating types:', error);
    process.exit(1);
  }
}

main();
