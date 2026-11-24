import { internal } from "../_generated/api";
import { queueOwnerNotification } from "./adminPush";

export async function verifiedCasePersonKey(ctx: any, booking: any): Promise<string | null> {
  if (!booking || !/^[a-f0-9]{64}$/.test(booking.renterPersonKey ?? "") ||
      !["didit", "reused_didit"].includes(booking.idVerificationSource ?? "") ||
      !Number.isSafeInteger(booking.idVerifiedAt) || booking.idVerifiedAt <= 0 ||
      !(booking.idVerifyStatus === "verified" || (booking.idVerifyStatus === "requires_input" && booking.verificationNote === "Your verification expired. Complete a new check before handover.")) ||
      !["identity", "selfie", "address"].every(key => booking.verificationChecks?.[key] === "approved")) return null;
  if (booking.idVerificationSource === "didit" && !booking.diditSessionId) return null;
  if (booking.idVerificationSource === "reused_didit") {
    if (!booking.verificationReusedFrom || !booking.accountId) return null;
    const source = await ctx.db.get(booking.verificationReusedFrom);
    if (!source || source.accountId !== booking.accountId || source.idVerificationSource !== "didit" || !source.diditSessionId || source.renterPersonKey !== booking.renterPersonKey ||
        !Number.isSafeInteger(source.idVerifiedAt) || source.idVerifiedAt !== booking.idVerifiedAt ||
        !(source.idVerifyStatus === "verified" || (source.idVerifyStatus === "requires_input" && source.verificationNote === "Your verification expired. Complete a new check before handover.")) ||
        !["identity", "selfie", "address"].every(key => source.verificationChecks?.[key] === "approved")) return null;
  }
  return booking.renterPersonKey;
}

export async function linkCaseIdentity(ctx: any, caseRecord: any, booking: any): Promise<boolean> {
  const key = await verifiedCasePersonKey(ctx, booking);
  if (!key || !caseRecord?._id || caseRecord.bookingId !== booking._id) return false;
  const existing = await ctx.db.query("rental_case_identity_links").withIndex("by_case", (query: any) => query.eq("caseId", caseRecord._id)).unique();
  if (existing) {
    if (existing.bookingId !== booking._id || existing.personKey !== key) {
      try { await queueOwnerNotification(ctx, { eventKey: `case-identity-source-changed:${caseRecord._id}`, kind: "identity_match", bookingId: booking._id, title: "Case identity needs review", body: "The verified identity linked to this case changed. Compare the original case and current verification; no automatic block was applied." }); }
      catch { console.error("Case identity change notification could not be queued."); }
    }
    return false;
  }
  const now = Date.now();
  const linkId = await ctx.db.insert("rental_case_identity_links", { caseId: caseRecord._id, bookingId: booking._id, personKey: key, verifiedAt: booking.idVerifiedAt, source: booking.idVerificationSource, createdAt: now });
  await ctx.db.insert("rental_case_identity_rechecks", { linkId, personKey: key, state: "pending", generation: 1, attempts: 0, dueAt: now, stage: 0, createdAt: now, updatedAt: now });
  return true;
}

export async function queueCaseIdentityBooking(ctx: any, bookingId: any): Promise<void> {
  const existing = await ctx.db.query("rental_case_identity_jobs").withIndex("by_booking", (query: any) => query.eq("bookingId", bookingId)).unique();
  const now = Date.now();
  const job = { bookingId, state: "pending" as const, generation: (existing?.generation ?? 0) + 1, attempts: 0, dueAt: now, cursor: undefined, updatedAt: now };
  if (existing) await ctx.db.patch(existing._id, job);
  else await ctx.db.insert("rental_case_identity_jobs", { ...job, createdAt: now });
  await ctx.scheduler.runAfter(0, (internal as any).caseIdentity.dispatchDue, {});
}

export async function queueCaseIdentityScan(ctx: any, bookingId: any, personKey: string): Promise<void> {
  const existing = await ctx.db.query("rental_case_identity_scans").withIndex("by_booking", (query: any) => query.eq("bookingId", bookingId)).unique();
  if (existing?.state === "pending" && existing.personKey === personKey && existing.dueAt <= Date.now()) return;
  if (existing && existing.personKey !== personKey && existing.alertEventKey) {
    const alert = await ctx.db.query("admin_notifications").withIndex("by_event", (query: any) => query.eq("eventKey", existing.alertEventKey)).first();
    if (alert && !alert.read) await ctx.db.patch(alert._id, { read: true });
  }
  const now = Date.now();
  const scan = { bookingId, personKey, state: "pending" as const, generation: (existing?.generation ?? 0) + 1, attempts: 0, dueAt: now, cursor: undefined, found: false, ...(existing?.personKey !== personKey ? { hadMatch: false, alertEventKey: undefined } : {}), updatedAt: now };
  if (existing) await ctx.db.patch(existing._id, scan);
  else await ctx.db.insert("rental_case_identity_scans", { ...scan, createdAt: now });
}
