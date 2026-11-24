import { validReuse, verificationDetail, verificationReuseOwnerMatches } from "./verificationReuse";
import { assertVerificationArchive, verificationArchiveHasIntegrity } from "../verificationArchive";
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

export async function accountVerificationBadge(ctx:any,account:any){
  const record=account?.rentalVerification;
  const expiresAt=record?verificationValidUntil(record):null;
  if(!account||account.blockedAt!=null||!account.emailVerifiedAt||!record||!Number.isSafeInteger(record.verifiedAt)||expiresAt==null||expiresAt<=Date.now())return null;
  const sourceId=ctx.db.normalizeId("bookings",record.sourceBookingId);if(!sourceId)return null;
  const source=await ctx.db.get(sourceId);
  if(!source||source.accountId!==account._id||source.verificationProvider!=="didit"||source.idVerificationSource!=="didit"||source.idVerifyStatus!=="verified"||!source.diditSessionId||source.verificationReuseBlockedSessionId===source.diditSessionId||source.idVerifiedAt!==record.verifiedAt||verificationValidUntil(source)!==expiresAt||record.name!==verificationDetail(source.agreementName)||record.address!==verificationDetail(source.billingAddress)||verificationDetail(account.name)!==record.name||!await verificationReuseOwnerMatches(ctx,source))return null;
  if(!await verificationArchiveHasIntegrity(ctx,source))return null;
  return {expiresAt};
}
