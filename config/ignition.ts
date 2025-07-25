export const ignition = {
  blockPollingInterval: 1_000,
  timeBeforeBumpingFees: 3 * 60 * 1_000,
  maxFeeBumps: 4,
  requiredConfirmations: 1,
  disableFeeBumping: true, // Disable fee bumping for local networks
  maxPendingTransactions: 1, // Reduce concurrent transactions
};
