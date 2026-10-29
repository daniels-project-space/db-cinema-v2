"use client";
export function CartStockNotice({checking,error,onRetry,needsTimes=false,missingItems=[],invalidTimeOrder=false,ready=false}:{checking:boolean;error:boolean;onRetry:()=>void;needsTimes?:boolean;missingItems?:string[];invalidTimeOrder?:boolean;ready?:boolean}) {
  const missingLabel=missingItems.length===1?missingItems[0]:missingItems.length===2?missingItems.join(" and "):missingItems.length>2?`${missingItems[0]}, ${missingItems[1]} and ${missingItems.length-2} more`:`${missingItems.length||"some"} items`;
  const timeMessages=[needsTimes?`Choose pickup and return times for ${missingLabel} in checkout; availability checks automatically.`:"",invalidTimeOrder?"For a same-day rental, return must be later than pickup.":""].filter(Boolean);
  const message=timeMessages.length?timeMessages.join(" "):error?"Availability could not be checked.":checking?"Checking current availability…":ready?"Availability checked.":"Availability will update when the check finishes.";
  return <div data-testid="cart-stock-check" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${error||invalidTimeOrder?"text-amber-200":"text-white/50"}`} role={error||invalidTimeOrder?"alert":"status"}>
    <span>{message}</span>
    {(error||ready)&&!needsTimes&&!invalidTimeOrder&&<button type="button" disabled={checking} onClick={onRetry} className="shrink-0 underline underline-offset-4 disabled:opacity-40">{error?"Try again":"Check again"}</button>}
  </div>;
}
