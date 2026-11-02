import { validReuse } from "./verificationReuse";
import { assertVerificationArchive } from "../verificationArchive";

export async function accountVerificationReady(ctx:any,account:any,name=account?.name,address=account?.address,starts=[Date.now()]){
  if(process.env.VERIFICATION_ARCHIVE_REUSE_ENABLED!=="true")return null;
  const record=account?.rentalVerification;
  if(!account||account.blockedAt!=null||account.emailVerificationRequired&&!account.emailVerifiedAt||!record||!Array.isArray(starts)||!starts.length||starts.length>100||
    !validReuse(record,{agreementName:name,billingAddress:address,lineItems:starts.map((start:number)=>({start}))}))return null;
  const sourceId=ctx.db.normalizeId("bookings",record.sourceBookingId);if(!sourceId)return null;
  const source=await ctx.db.get(sourceId);
  if(!source||source.accountId!==account._id||source.accountAccessRequired!==false||source.idVerifyStatus!=="verified"||source.idVerificationSource!=="didit"||!source.diditSessionId||source.verificationReuseBlockedSessionId===source.diditSessionId||!source.renterPersonKey||!source.documentExpiresAt||record.expiresAt>source.documentExpiresAt||!["identity","selfie","address"].every(key=>source.verificationChecks?.[key]==="approved"))return null;
  try{const proofExpiresAt=await assertVerificationArchive(ctx,source);if(!proofExpiresAt)return null;return {expiresAt:record.expiresAt,proofExpiresAt:Math.min(record.expiresAt,proofExpiresAt)};}catch{return null}
}
