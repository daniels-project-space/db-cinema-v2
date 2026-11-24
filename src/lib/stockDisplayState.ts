export type StockDisplayResult = {
  available?: number;
  ok?: boolean | null;
  stockStatus?: string;
} | null | undefined;

export type StockDisplayState = "checking" | "unknown" | "available" | "unavailable" | "kit-limit";

export function stockDisplayState(result: StockDisplayResult): StockDisplayState {
  if (!result) return "checking";
  if (result.stockStatus === "refresh_required" || result.ok == null) return "unknown";
  if (result.ok) return "available";
  return result.available === 0 ? "unavailable" : "kit-limit";
}
