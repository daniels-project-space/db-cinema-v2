export function swapAuthorityAvailable(): boolean {
  return false;
}
export function assertSwapAuthorityAvailable(): void {
  if (!swapAuthorityAvailable()) throw Error("Equipment swaps are unavailable until shared stock authority is verified.");
}
