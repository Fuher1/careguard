export const TX_HASH_DISPLAY_LENGTH = 16;

export function truncateTransactionHash(hash: string): string {
  return `${hash.slice(0, TX_HASH_DISPLAY_LENGTH)}...`;
}
