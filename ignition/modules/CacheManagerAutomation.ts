import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export function createCacheManagerAutomationModule(version: string) {
  return buildModule(`CacheManagerAutomation_${version}`, (m) => {
    // Get network-specific parameters
    const cacheManagerAddress = m.getParameter('cacheManagerAddress');
    const arbWasmCacheAddress = m.getParameter('arbWasmCacheAddress');

    const cacheManagerAutomation = m.contract('CacheManagerAutomation', [
      cacheManagerAddress,
      arbWasmCacheAddress,
    ]);

    return { cacheManagerAutomation };
  });
}

// Default export for backward compatibility
export default buildModule('CacheManagerAutomation', (m) => {
  // Get network-specific parameters
  const cacheManagerAddress = m.getParameter('cacheManagerAddress');
  const arbWasmCacheAddress = m.getParameter('arbWasmCacheAddress');

  const cacheManagerAutomation = m.contract('CacheManagerAutomation', [
    cacheManagerAddress,
    arbWasmCacheAddress,
  ]);

  return { cacheManagerAutomation };
});
