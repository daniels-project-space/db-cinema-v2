/** State guard for retrying a previously accepted Stripe Checkout Session. */
export function checkoutSessionState(session:any):"paid"|"open_unpaid"|"expired_unpaid"|"indeterminate"{
  if(session?.payment_status==="paid"||session?.status==="complete"&&session?.payment_status==="no_payment_required")return "paid";
  if(session?.status==="open"&&session?.payment_status==="unpaid")return "open_unpaid";
  if(session?.status==="expired"&&session?.payment_status==="unpaid")return "expired_unpaid";
  return "indeterminate";
}

/** Expire only a provider-confirmed unpaid session. If it completed while the
 * expiry request was in flight, return that payment for normal reconciliation
 * and keep the original accepted rental untouched. */
export async function expireUnpaidCheckoutSession(args:{
  session:any;
  expireStripe:(sessionId:string)=>Promise<any>;
  retrieveStripe:(sessionId:string)=>Promise<any>;
  expireBooking:(sessionId:string)=>Promise<boolean>;
}){
  let current=args.session;
  if(checkoutSessionState(current)==="open_unpaid"){
    try{current=await args.expireStripe(current.id);}
    catch{current=await args.retrieveStripe(current.id);}
  }
  const state=checkoutSessionState(current);
  if(state==="paid")return {state:"paid" as const,session:current,bookingExpired:false};
  if(state!=="expired_unpaid")return {state:"indeterminate" as const,session:current,bookingExpired:false};
  const bookingExpired=await args.expireBooking(current.id);
  return {state:"expired_unpaid" as const,session:current,bookingExpired};
}
