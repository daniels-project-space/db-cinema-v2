import { belongsToRentalAccount } from "./rentalAccount";

/** One approved customer request may create one immutable, account-bound proposal. */
export async function approvedKitRequest(ctx:any,booking:any,id:any,proposalId?:any){
  if(!id)return null;
  const request=await ctx.db.get(id),account=request?await ctx.db.get(request.accountId):null;
  if(!request||request.bookingId!==booking?._id||request.kind!=="items"||request.status!=="approved"||request.execution||!belongsToRentalAccount(booking,account))
    throw Error("Choose an approved kit request for this rental and account.");
  if(request.additionRequestId&&request.additionRequestId!==proposalId)
    throw Error("This request already has a saved proposal. Review it or approve a new request.");
  if(proposalId&&request.additionRequestId!==proposalId)
    throw Error("The saved proposal no longer matches this customer request.");
  return request;
}

export function assertKitAddition(request:any,listingId:any,qty:number){
  const selection=request?.kitSelection;
  if(selection&&(selection.change!=="add"||selection.listingId!==listingId||selection.quantity!==qty))
    throw Error("This proposal does not match the approved equipment addition. Use the agreed request’s item and quantity.");
}
