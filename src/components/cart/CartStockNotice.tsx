"use client";
export function CartStockNotice({checking,error,onRetry}:{checking:boolean;error:boolean;onRetry:()=>void}) {
  return <div data-testid="cart-stock-check" className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${error?"border-amber-400/25 bg-amber-400/5 text-amber-200":"border-white/10 text-white/50"}`} role={error?"alert":"status"}>
    <span>{error?"We couldn't check availability. Try again before checkout.":checking?"Checking current equipment availability…":"Equipment availability checked."}</span>
    <button type="button" disabled={checking} onClick={onRetry} className="shrink-0 underline underline-offset-4 disabled:opacity-40">{error?"Try again":"Check again"}</button>
  </div>;
}
