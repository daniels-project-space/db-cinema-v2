import { validReuse, verificationReuseOwnerMatches } from "./verificationReuse";
import { assertVerificationArchive } from "../verificationArchive";
import { verificationValidUntil } from "../../shared/verificationProgress";

export async function accountVerificationReady(ctx:any,account:any,name=account?.name,address=account?.address,starts=[Date.now()]){
  const record=account?.rentalVerification;
  const expiresAt=record?verificationValidUntil(record):null;
  if(!account||account.blockedAt!=null||account.emailVerificationRequired&&!account.emailVerifiedAt||!record||expiresAt==null||!Array.isArray(starts)||!starts.length||starts.length>100||
    !validReuse(record,{agreementName:name,billingAddress:address,lineItems:starts.map((start:number)=>({start}))}))return null;
  const sourceId=ctx.db.normalizeId("bookings",record.sourceBookingId);if(!sourceId)return null;
  const source=await ctx.db.get(sourceId);
  if(!source||source.accountId!==account._id||!await verificationReuseOwnerMatches(ctx,source)||source.idVerifyStatus!=="verified"||source.idVerificationSource!=="didit"||!source.diditSessionId||source.verificationReuseBlockedSessionId===source.diditSessionId||!["identity","selfie","address"].every(key=>source.verificationChecks?.[key]==="approved"))return null;
  try{const proofExpiresAt=await assertVerificationArchive(ctx,source);if(!proofExpiresAt)return null;return {expiresAt,proofExpiresAt:Math.min(expiresAt,proofExpiresAt)};}catch{return null}
}
