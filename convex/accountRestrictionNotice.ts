import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";

const LEASE = 10 * 60_000;

async function attention(ctx: any, notice: any) {
  await ctx.db.patch(notice._id, { state: "attention", updatedAt: Date.now(), dueAt: Date.now() });
  await queueOwnerNotification(ctx, { eventKey: `restriction-notice:${notice._id}`, kind: "email_failure", accountId: notice.accountId,
    title: "Account notice needs attention", body: "The account restriction email could not be confirmed. Check the customer record and contact them manually if appropriate." });
}

async function dispatch(ctx: any, notice: any) {
  const now = Date.now();
  if (!notice || notice.dueAt > now) return;
  if (notice.state === "sending" || notice.state === "delivering") return attention(ctx, notice);
  if (notice.state !== "pending") return;
  const account = await ctx.db.get(notice.accountId);
  if (!account || account.restrictionNoticeId !== notice._id || account.blockedAt !== notice.blockedAt || account.email !== notice.recipient) {
    await ctx.db.patch(notice._id, { state: "skipped", dueAt: now, updatedAt: now });
    return;
  }
  if (!account.emailVerifiedAt || account.emailVerificationRequired) return attention(ctx, notice);
  await ctx.db.patch(notice._id, { state: "sending", dueAt: now + LEASE, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.accountRestrictionMail.deliver, { noticeId: notice._id });
}

export const dispatchOne = internalMutation({ args: { noticeId: v.id("account_restriction_notices") }, handler: async (ctx, { noticeId }) => dispatch(ctx, await ctx.db.get(noticeId)) });
export const dispatchDue = internalMutation({ args: {}, handler: async ctx => {
  for (const state of ["pending", "sending", "delivering"] as const) {
    const notices = await ctx.db.query("account_restriction_notices").withIndex("by_state_due", q => q.eq("state", state).lte("dueAt", Date.now())).take(20);
    for (const notice of notices) await dispatch(ctx, notice);
  }
} });
export const claim = internalMutation({ args: { noticeId: v.id("account_restriction_notices") }, handler: async (ctx, { noticeId }) => {
  const notice = await ctx.db.get(noticeId);
  if (!notice || notice.state !== "sending" || notice.dueAt <= Date.now()) return null;
  const account = await ctx.db.get(notice.accountId);
  if (!account || account.restrictionNoticeId !== notice._id || account.blockedAt !== notice.blockedAt || account.email !== notice.recipient || !account.emailVerifiedAt || account.emailVerificationRequired) {
    await ctx.db.patch(noticeId, { state: "skipped", dueAt: Date.now(), updatedAt: Date.now() });
    return null;
  }
  await ctx.db.patch(noticeId, { state: "delivering", updatedAt: Date.now() });
  return { recipient: notice.recipient };
} });
export const finish = internalMutation({ args: { noticeId: v.id("account_restriction_notices"), result: v.union(v.literal("sent"), v.literal("skipped"), v.literal("uncertain")) }, handler: async (ctx, { noticeId, result }) => {
  const notice = await ctx.db.get(noticeId);
  if (!notice || notice.state !== "delivering") return;
  if (result === "uncertain") return attention(ctx, notice);
  const now = Date.now();
  await ctx.db.patch(noticeId, { state: result, dueAt: now, updatedAt: now, ...(result === "sent" ? { sentAt: now } : {}) });
} });
