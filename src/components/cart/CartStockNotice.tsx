"use client";
export function CartStockNotice({checking,error,onRetry,needsTimes=false}:{checking:boolean;error:boolean;onRetry:()=>void;needsTimes?:boolean}) {
  return <div data-testid="cart-stock-check" className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${error?"border-amber-400/25 bg-amber-400/5 text-amber-200":"border-white/10 text-white/50"}`} role={error?"alert":"status"}>
    <span>{needsTimes?"Choose pickup and return times for every item to check availability.":error?"We couldn't check availability. Try again before checkout.":checking?"Checking current equipment availability…":"Equipment availability checked."}</span>
    <button type="button" disabled={checking||needsTimes} onClick={onRetry} className="shrink-0 underline underline-offset-4 disabled:opacity-40">{error?"Try again":"Check again"}</button>
  </div>;
}
