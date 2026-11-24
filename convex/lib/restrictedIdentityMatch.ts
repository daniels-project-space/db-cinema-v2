import { queueOwnerNotification } from "./adminPush";
import { verificationValidUntil } from "../../shared/verificationProgress";

export async function approvedRestrictedIdentitySource(ctx:any, booking:any, sessionId?:string) {
  if (!booking || booking.idVerifyStatus !== "verified" || !booking.renterPersonKey || !["identity","selfie","address"].every(key=>booking.verificationChecks?.[key] === "approved")) return false;
  const now = Date.now();
  const bookingValidUntil = verificationValidUntil(booking);
  if (bookingValidUntil === null || bookingValidUntil <= now) return false;
  if (booking.idVerificationSource === "didit") return !!booking.diditSessionId && (!sessionId || booking.diditSessionId === sessionId);
  if (booking.idVerificationSource !== "reused_didit" || !booking.verificationReusedFrom || !booking.accountId) return false;
  const source = await ctx.db.get(booking.verificationReusedFrom);
  const sourceValidUntil = verificationValidUntil(source);
  return !!source && sourceValidUntil !== null && sourceValidUntil > now && source.accountId === booking.accountId && source.idVerifyStatus === "verified" && source.idVerificationSource === "didit" && !!source.diditSessionId && (!sessionId || source.diditSessionId === sessionId) && source.renterPersonKey === booking.renterPersonKey && ["identity","selfie","address"].every(key=>source.verificationChecks?.[key] === "approved");
}

export async function sameAccountApprovedDiditSource(ctx:any, booking:any, personKey:string) {
  if (!booking?.accountId || !/^[a-f0-9]{64}$/.test(personKey)) return null;
  const account = await ctx.db.get(booking.accountId);
  const identityLinkUnresolved = (source: any) => [
    "The verified person could not be linked to the rental identity record.",
    "Didit approved the identity, but cross-account identity matching is unavailable.",
  ].includes(source?.identityRiskNotice);
  const approvedSameIdentity = (source:any) => {
    const checksApproved = (["identity", "selfie", "address"] as const).every(key => source?.verificationChecks?.[key] === "approved");
    const currentApproval = source?.idVerifyStatus === "verified" && !!source.diditSessionId && checksApproved;
    const expiredApproval = source?.idVerifyStatus === "requires_input" &&
      source.verificationNote === "Your verification expired. Complete a new check before handover." &&
      Number.isFinite(source.idVerifiedAt) && checksApproved;
    return source?.accountId === booking.accountId && !identityLinkUnresolved(source) &&
      source.idVerificationSource === "didit" && source.renterPersonKey === personKey && (currentApproval || expiredApproval);
  };
  const snapshotId = booking.identityMatchSameAccountSourceBookingId;
  if (snapshotId && String(snapshotId) === String(booking._id) && booking.renterPersonKey === personKey &&
      !identityLinkUnresolved(booking)) {
    return booking._id;
  }
  if (snapshotId && String(snapshotId) !== String(booking._id)) {
    const snapshot = await ctx.db.get(snapshotId);
    if (approvedSameIdentity(snapshot) && Number.isFinite(snapshot._creationTime) && Number.isFinite(booking._creationTime) &&
        snapshot._creationTime < booking._creationTime) return snapshot._id;
  }
  const accountSourceId = account?.rentalVerification?.sourceBookingId;
  if (accountSourceId && String(accountSourceId) !== String(booking._id)) {
    const accountSource = await ctx.db.get(accountSourceId);
    if (approvedSameIdentity(accountSource)) return accountSource._id;
  }
  const historicalSources = await ctx.db.query("bookings")
    .withIndex("by_account_person_approval_source", (q: any) => q
      .eq("accountId", booking.accountId)
      .eq("renterPersonKey", personKey)
      .eq("idVerificationSource", "didit"))
    .order("desc")
    .take(10);
  const historicalSource = historicalSources.find((source: any) => String(source._id) !== String(booking._id) && approvedSameIdentity(source));
  if (historicalSource) return historicalSource._id;
  return null;
}

async function findRestrictedIdentityMatches(ctx: any, booking: any, personKey: string) {
  if (!/^[a-f0-9]{64}$/.test(personKey)) return { matches: [], more: false };
  const [blacklisted, legacy] = await Promise.all([
    ctx.db.query("accounts").withIndex("by_person_restriction_class", (q: any) => q.eq("renterPersonKey", personKey).eq("restrictionClass", "identity_safety_blacklist").gt("blockedAt", 0)).take(22),
    ctx.db.query("accounts").withIndex("by_person_restriction_class", (q: any) => q.eq("renterPersonKey", personKey).eq("restrictionClass", undefined).gt("blockedAt", 0)).take(22),
  ]);
  const matches = [...blacklisted, ...legacy].filter((account: any) =>
    !booking.accountId || String(account._id) !== String(booking.accountId),
  );
  return { matches: matches.slice(0, 20), more: blacklisted.length > 21 || legacy.length > 21 || matches.length > 20 };
}

export async function restrictedIdentityMatches(ctx: any, booking: any, personKey: string) {
  if (!/^[a-f0-9]{64}$/.test(personKey)) return { matches: [], more: false };
  return findRestrictedIdentityMatches(ctx, booking, personKey);
}

async function resolveObsoleteIdentityNotice(ctx: any, booking: any) {
  const notices = await ctx.db.query("admin_notifications")
    .withIndex("by_booking_kind_read_created", (q: any) => q
      .eq("bookingId", booking._id)
      .eq("kind", "identity_match")
      .eq("read", false))
    .take(50);
  const eventPrefix = `restricted-identity-match:${booking._id}:`;
  for (const notice of notices) {
    if (notice.eventKey.startsWith(eventPrefix) && notice.title === "Possible match to a restricted account")
      await ctx.db.patch(notice._id, { read: true });
  }
}

export async function notifyRestrictedIdentityMatch(ctx: any, booking: any, personKey: string) {
  if (!/^[a-f0-9]{64}$/.test(personKey)) return false;
  const result = await restrictedIdentityMatches(ctx, booking, personKey);
  if (!result.matches.length) {
    await resolveObsoleteIdentityNotice(ctx, booking);
    return false;
  }
  await queueOwnerNotification(ctx, {
    eventKey: `restricted-identity-match:${booking._id}:${result.matches.map((account:any)=>`${account._id}:${account.blockedAt}`).sort().join("|")}`,
    kind: "identity_match", ...(booking.accountId ? { accountId: booking.accountId } : {}), bookingId: booking._id,
    title: "Possible match to a restricted account",
    body: "An approved name and date of birth match a restricted account. Compare the records manually; this is not proof that they are the same person. No automatic block was applied.",
  });
  return true;
}
