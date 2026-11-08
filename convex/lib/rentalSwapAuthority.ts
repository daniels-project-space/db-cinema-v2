import { sharedStockTransportConfigured } from "./sharedStockTransport";

export function swapAuthorityAvailable(): boolean {
  return process.env.SHARED_STOCK_AUTHORITY_READY === "enabled" &&
    process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL === "true" &&
    sharedStockTransportConfigured(process.env.RMV2_WEBHOOK_URL, process.env.SHARED_STOCK_WEBSITE_SECRET);
}
export function assertSwapAuthorityAvailable(): void {
  if (!swapAuthorityAvailable()) throw Error("Equipment swaps are temporarily unavailable while stock coordination is offline.");
}
