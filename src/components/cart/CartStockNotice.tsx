"use client";
export function CartStockNotice({checking,error,onRetry,needsTimes=false,invalidTimeOrder=false,ready=false}:{checking:boolean;error:boolean;onRetry:()=>void;needsTimes?:boolean;missingItems?:string[];invalidTimeOrder?:boolean;ready?:boolean}) {
  const timeMessages=[needsTimes?"Exact pickup and return times are set at checkout.":"",invalidTimeOrder?"For a same-day rental, return must be later than pickup.":""].filter(Boolean);
  const message=timeMessages.length?timeMessages.join(" "):error?"Availability could not be checked.":checking?"Checking current availability…":ready?"Availability checked.":"Availability will update when the check finishes.";
  return <div data-testid="cart-stock-check" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${error||invalidTimeOrder?"text-amber-200":"text-white/50"}`} role={error||invalidTimeOrder?"alert":"status"}>
    <span>{message}</span>
    {(error||ready)&&!needsTimes&&!invalidTimeOrder&&<button type="button" disabled={checking} onClick={onRetry} className="shrink-0 underline underline-offset-4 disabled:opacity-40">{error?"Try again":"Check again"}</button>}
  </div>;
}
