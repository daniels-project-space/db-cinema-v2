import { queueOwnerNotification } from "./adminPush";

export async function approvedRestrictedIdentitySource(ctx:any, booking:any, sessionId?:string) {
  if (!booking || booking.idVerifyStatus !== "verified" || !booking.renterPersonKey || !["identity","selfie","address"].every(key=>booking.verificationChecks?.[key] === "approved")) return false;
  if (booking.idVerificationSource === "didit") return !!booking.diditSessionId && (!sessionId || booking.diditSessionId === sessionId);
  if (booking.idVerificationSource !== "reused_didit" || !booking.verificationReusedFrom || !booking.accountId) return false;
  const source = await ctx.db.get(booking.verificationReusedFrom);
  return !!source && source.accountId === booking.accountId && source.idVerifyStatus === "verified" && source.idVerificationSource === "didit" && !!source.diditSessionId && (!sessionId || source.diditSessionId === sessionId) && source.renterPersonKey === booking.renterPersonKey && ["identity","selfie","address"].every(key=>source.verificationChecks?.[key] === "approved");
}

export async function restrictedIdentityMatches(ctx: any, booking: any, personKey: string) {
  if (!/^[a-f0-9]{64}$/.test(personKey)) return { matches: [], more: false };
  const rows = await ctx.db.query("accounts").withIndex("by_person_restricted", (q: any) => q.eq("renterPersonKey", personKey).gt("blockedAt", 0)).take(22);
  const matches = rows.filter((account: any) => !booking.accountId || String(account._id) !== String(booking.accountId));
  return { matches: matches.slice(0, 20), more: rows.length > 21 || matches.length > 20 };
}

export async function notifyRestrictedIdentityMatch(ctx: any, booking: any, personKey: string) {
  const result = await restrictedIdentityMatches(ctx, booking, personKey);
  if (!result.matches.length) return false;
  await queueOwnerNotification(ctx, {
    eventKey: `restricted-identity-match:${booking._id}:${result.matches.map((account:any)=>`${account._id}:${account.blockedAt}`).sort().join("|")}`,
    kind: "identity_match", ...(booking.accountId ? { accountId: booking.accountId } : {}), bookingId: booking._id,
    title: "Possible match to a restricted account",
    body: "An approved name and date of birth match a restricted account. Compare the records manually; this is not proof that they are the same person. No automatic block was applied.",
  });
  return true;
}
