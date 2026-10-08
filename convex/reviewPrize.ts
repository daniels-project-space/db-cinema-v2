import { unlockLoyalty, encoreGate } from "./lib/loyalty";
import { REVIEW_PRIZE_GBP } from "../shared/reviewPrize";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking } from "./lib/rentalChat";
import {
  customerReviewGate,
  reviewSettlementFingerprint,
} from "./lib/reviewEligibility";
import { reviewContext } from "./lib/reviewContext";
import {
  reviewPrizeRound,
  reviewPostUrl,
  REVIEW_PRIZE_TERMS,
  REVIEW_SOCIAL,
} from "../shared/reviewPrize";
async function settled(ctx: any, b: any) {
  return (
    !!b &&
    !customerReviewGate(b) &&
    b.reviewEligibilityFingerprint ===
      reviewSettlementFingerprint(await reviewContext(ctx, b))
  );
}
async function entryView(ctx: any, e: any) {
  const b = await ctx.db.get(e.bookingId);
  const r = await ctx.db.get(e.reviewId);
  const round = await ctx.db
    .query("review_prize_rounds")
    .withIndex("by_key", (q: any) => q.eq("key", e.roundKey))
    .first();
  return {
    ...e,
    review: r?.text,
    rating: r?.rating,
    securitySettled: !!b && (await settled(ctx, b)),
    evidenceUrl: await ctx.storage.getUrl(e.evidenceStorageId),
    round: round
      ? {
          key: round.key,
          deadline: round.deadline,
          announceBy: round.announceBy,
          payBy: round.payBy,
          status: round.status,
          paid: e.status === "winner" && !!round.paidAt,
        }
      : null,
  };
}
export const schedule = query({
  args: {},
  handler: async (ctx) => {
    const current = reviewPrizeRound();
    const rounds = await ctx.db.query("review_prize_rounds").collect();
    return {
      closed: rounds
        .filter((r) => r.status === "closed_no_eligible_entries")
        .map((r) => ({ key: r.key })),
      current,
      social: REVIEW_SOCIAL,
      termsVersion: REVIEW_PRIZE_TERMS,
      past: await Promise.all(
        rounds
          .filter((r) => r.winnerEntryId)
          .map(async (r) => {
            const e = await ctx.db.get(r.winnerEntryId!);
            const a = e ? await ctx.db.get(e.accountId) : null;
            return {
              key: r.key,
              deadline: r.deadline,
              paid: !!r.paidAt,
              name: a?.name?.split(" ")[0] ?? "A DB Cinema filmmaker",
              story: e?.story ?? "",
              judge: e?.judgeName,
            };
          }),
      ),
    };
  },
});
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = await accountForToken(ctx, token);
    if (!a) throw Error("Please sign in.");
    const entries = await ctx.db
      .query("review_prize_entries")
      .withIndex("by_account", (q) => q.eq("accountId", a._id))
      .collect();
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_guestEmail", (q) => q.eq("guestEmail", a.email))
      .collect();
    return {
      currentRoundKey: reviewPrizeRound().key,
      entries: await Promise.all(entries.map((e) => entryView(ctx, e))),
      bookings: await Promise.all(
        bookings
          .filter((b) => b.status === "returned" && !customerReviewGate(b))
          .map(async (b) => ({
            _id: b._id,
            title: b.lineItems.map((l) => l.title).join(", "),
            settled: await settled(ctx, b),
            review: await ctx.db
              .query("reviews")
              .withIndex("by_booking", (q) => q.eq("verifiedBookingId", b._id))
              .first(),
          })),
      ),
    };
  },
});
export const uploadEvidence = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!(await accountForToken(ctx, token))) throw Error("Please sign in.");
    return ctx.storage.generateUploadUrl();
  },
});
export const submit = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    story: v.string(),
    rating: v.number(),
    review: v.string(),
    socialHandle: v.string(),
    postUrl: v.string(),
    evidenceStorageId: v.id("_storage"),
    termsVersion: v.string(),
    adult: v.boolean(),
    followDeclared: v.boolean(),
    disclosureDeclared: v.boolean(),
  },
  handler: async (ctx, a) => {
    const account = await accountForToken(ctx, a.token);
    if (!account) throw Error("Please sign in.");
    const b = await ownedBooking(ctx, account, a.bookingId);
    if (!(await settled(ctx, b)))
      throw Error(
        "Your rental must be returned with its deposit fully refunded and every hold released, with no security deductions. Recheck settlement first.",
      );
    if (
      a.termsVersion !== REVIEW_PRIZE_TERMS ||
      !a.adult ||
      !a.followDeclared ||
      !a.disclosureDeclared
    )
      throw Error(
        "Confirm the entry conditions, follow and advertising disclosure.",
      );
    if (a.story.trim().length < 150 || a.story.length > 3000)
      throw Error("Tell your set story in 150–3,000 characters.");
    if (
      !Number.isInteger(a.rating) ||
      a.rating < 1 ||
      a.rating > 5 ||
      a.review.trim().length < 10 ||
      a.review.length > 2000
    )
      throw Error("Enter a genuine 1–5 star review, 10–2,000 characters.");
    const socialHandle = a.socialHandle.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(socialHandle))
      throw Error("Enter your Instagram handle.");
    const postUrl = reviewPostUrl(a.postUrl);
    const evidence = await ctx.db.system.get(a.evidenceStorageId);
    if (
      !evidence ||
      evidence.size > 8 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(
        evidence.contentType ?? "",
      )
    )
      throw Error("Upload a JPG, PNG or WebP screenshot up to 8 MB.");
    const claimed = await ctx.db
      .query("review_prize_evidence")
      .withIndex("by_storage", (q) => q.eq("storageId", a.evidenceStorageId))
      .first();
    if (claimed && claimed.accountId !== account._id)
      throw Error("This evidence belongs to another account.");
    if (!claimed)
      await ctx.db.insert("review_prize_evidence", {
        storageId: a.evidenceStorageId,
        accountId: account._id,
        claimedAt: Date.now(),
      });
    const duplicatePost = await ctx.db
      .query("review_prize_entries")
      .withIndex("by_post", (q) => q.eq("postUrl", postUrl))
      .first();
    if (duplicatePost && duplicatePost.bookingId !== b._id)
      throw Error(
        "Each entry needs its own set-experience post; this post already has an entry.",
      );
    const round = reviewPrizeRound();
    let existing = await ctx.db
      .query("review_prize_entries")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .first();
    if (
      existing &&
      (existing.roundKey !== round.key || existing.status === "winner")
    )
      throw Error(
        "This rental already has an entry; it cannot be entered again in another round.",
      );
    let review = await ctx.db
      .query("reviews")
      .withIndex("by_booking", (q) => q.eq("verifiedBookingId", b._id))
      .first();
    if (review && review.authorAccountId !== account._id)
      throw Error("Review ownership mismatch.");
    let reviewId = review?._id;
    if (!reviewId)
      reviewId = await ctx.db.insert("reviews", {
        source: "native",
        author: account.name ?? account.email.split("@")[0],
        authorAccountId: account._id,
        rating: a.rating,
        text: a.review.trim(),
        product: b.lineItems[0]?.title,
        verifiedBookingId: b._id,
        date: Date.now(),
        published: true,
        incentivized: true,prizeEntry:true,encoreReward:!encoreGate(b),
      });
    else await ctx.db.patch(reviewId, { incentivized: true,prizeEntry:true,encoreReward:review?.encoreReward||!encoreGate(b) });
    await unlockLoyalty(ctx,account);
    const patch = {
      accountId: account._id,
      bookingId: b._id,
      reviewId,
      roundKey: round.key,
      story: a.story.trim(),
      socialHandle,
      postUrl,
      evidenceStorageId: a.evidenceStorageId,
      status: "evidence_pending",
      termsVersion: a.termsVersion,
      followDeclared: a.followDeclared,
      disclosureDeclared: a.disclosureDeclared,
      updatedAt: Date.now(),
      socialVerifiedAt: undefined,
      verificationNote: undefined,
      originality: undefined,
      craft: undefined,
      clarity: undefined,
      judgeName: undefined,
      judgedAt: undefined,
      judgingNote: undefined,
    };
    const id = existing
      ? existing._id
      : await ctx.db.insert("review_prize_entries", {
          ...patch,
          submittedAt: Date.now(),
        });
    if (existing) await ctx.db.patch(id, patch);
    if (
      !(await ctx.db
        .query("review_prize_rounds")
        .withIndex("by_key", (q) => q.eq("key", round.key))
        .first())
    )
      await ctx.db.insert("review_prize_rounds", { ...round, status: "open" });
    return { id, status: "evidence_pending" };
  },
});
export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    return {
      rounds: await ctx.db.query("review_prize_rounds").collect(),
      entries: await Promise.all(
        (await ctx.db.query("review_prize_entries").collect()).map(
          async (e) => ({
            ...(await entryView(ctx, e)),
            email: (await ctx.db.get(e.accountId))?.email,
          }),
        ),
      ),
    };
  },
});
export const verifySocial = mutation({
  args: {
    token: v.string(),
    id: v.id("review_prize_entries"),
    approved: v.boolean(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "reviewPrize.verifySocial");
    const e = await ctx.db.get(a.id);
    if (!e || e.status === "winner") throw Error("Entry unavailable.");
    if (a.note.trim().length < 10)
      throw Error(
        "Record the follow, tag and #ad evidence checked, or the correction needed.",
      );
    if (a.approved && !(await settled(ctx, await ctx.db.get(e.bookingId))))
      throw Error("Security settlement changed; recheck before approving.");
    await ctx.db.patch(e._id, {
      status: a.approved ? "eligible" : "needs_evidence",
      socialVerifiedAt: a.approved ? Date.now() : undefined,
      verificationNote: a.note.trim(),
      updatedAt: Date.now(),
    });
  },
});
export const judge = mutation({
  args: {
    token: v.string(),
    id: v.id("review_prize_entries"),
    judgeName: v.string(),
    independent: v.boolean(),
    originality: v.number(),
    craft: v.number(),
    clarity: v.number(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "reviewPrize.judge");
    const e = await ctx.db.get(a.id);
    if (!e || e.status !== "eligible")
      throw Error("Only verified eligible entries can be judged.");
    const round = await ctx.db
      .query("review_prize_rounds")
      .withIndex("by_key", (q) => q.eq("key", e.roundKey))
      .first();
    if (!round || Date.now() <= round.deadline || round.winnerEntryId)
      throw Error(
        "Judging opens after the deadline and closes when a winner is selected.",
      );
    if (
      !a.independent ||
      a.judgeName.trim().length < 3 ||
      a.note.trim().length < 20
    )
      throw Error(
        "Record the independent judge and their story-based decision.",
      );
    for (const [score, max] of [
      [a.originality, 50],
      [a.craft, 30],
      [a.clarity, 20],
    ])
      if (!Number.isInteger(score) || score < 0 || score > max)
        throw Error("Invalid judging score.");
    if (!(await settled(ctx, await ctx.db.get(e.bookingId))))
      throw Error("Security settlement changed.");
    await ctx.db.patch(e._id, {
      judgeName: a.judgeName.trim(),
      originality: a.originality,
      craft: a.craft,
      clarity: a.clarity,
      judgingNote: a.note.trim(),
      judgedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
export const selectWinner = mutation({
  args: {
    token: v.string(),
    roundKey: v.string(),
    id: v.id("review_prize_entries"),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "reviewPrize.selectWinner");
    const round = await ctx.db
      .query("review_prize_rounds")
      .withIndex("by_key", (q) => q.eq("key", a.roundKey))
      .first();
    if (!round || Date.now() <= round.deadline)
      throw Error("Wait until entries close.");
    if (round.winnerEntryId) {
      if (round.winnerEntryId === a.id) return round._id;
      throw Error("This round already has a winner.");
    }
    const entries = await ctx.db
      .query("review_prize_entries")
      .withIndex("by_round", (q) => q.eq("roundKey", a.roundKey))
      .collect();
    const valid = [];
    for (const e of entries)
      if (
        e.status === "eligible" &&
        (await settled(ctx, await ctx.db.get(e.bookingId)))
      )
        valid.push(e);
    if (valid.some((e) => !e.judgedAt))
      throw Error(
        "The independent judge must score every eligible entry first.",
      );
    if (entries.some((e) => e.status === "evidence_pending"))
      throw Error(
        "Review every submitted evidence pack before choosing a winner.",
      );
    const score = (e: any) =>
      (e.originality ?? 0) + (e.craft ?? 0) + (e.clarity ?? 0);
    valid.sort(
      (a, b) =>
        score(b) - score(a) ||
        (b.originality ?? 0) - (a.originality ?? 0) ||
        a.submittedAt - b.submittedAt,
    );
    const winner = valid[0];
    if (!winner || winner._id !== a.id)
      throw Error(
        "Select the top-scoring story; star ratings are not judging criteria.",
      );
    await ctx.db.patch(winner._id, { status: "winner", updatedAt: Date.now() });
    await ctx.db.patch(round._id, {
      winnerEntryId: winner._id,
      selectedAt: Date.now(),
      status: "payment_due",
    });
    await ctx.scheduler.runAfter(0, internal.reviewPrizeMail.processDue, {});
    return round._id;
  },
});
export const closeWithoutWinner = mutation({
  args: { token: v.string(), roundKey: v.string() },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "reviewPrize.closeWithoutWinner");
    const round = await ctx.db
      .query("review_prize_rounds")
      .withIndex("by_key", (q) => q.eq("key", a.roundKey))
      .first();
    if (!round || Date.now() <= round.deadline || round.winnerEntryId)
      throw Error("Only a closed round without a winner can be completed.");
    const entries = await ctx.db
      .query("review_prize_entries")
      .withIndex("by_round", (q) => q.eq("roundKey", a.roundKey))
      .collect();
    if (entries.some((e) => e.status === "evidence_pending"))
      throw Error("Review all submitted evidence first.");
    for (const e of entries)
      if (
        e.status === "eligible" &&
        (await settled(ctx, await ctx.db.get(e.bookingId)))
      )
        throw Error(
          "Eligible entries require independent judging and a winner.",
        );
    await ctx.db.patch(round._id, { status: "closed_no_eligible_entries" });
    return round._id;
  },
});
export const recordPaid = mutation({
  args: { token: v.string(), roundKey: v.string(), reference: v.string() },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "reviewPrize.recordPaid");
    const round = await ctx.db
      .query("review_prize_rounds")
      .withIndex("by_key", (q) => q.eq("key", a.roundKey))
      .first();
    if (!round?.winnerEntryId) throw Error("Select a winner first.");
    if (round.paidAt) return { paidAt: round.paidAt };
    if (a.reference.trim().length < 6)
      throw Error(
        `Enter the actual £${REVIEW_PRIZE_GBP} transfer reference. This records payment; it does not move funds.`,
      );
    await ctx.db.patch(round._id, {
      paidAt: Date.now(),
      paymentReference: a.reference.trim(),
      status: "paid",
    });
    return { paidAt: Date.now() };
  },
});
export const maintenance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const current = reviewPrizeRound();
    if (
      !(await ctx.db
        .query("review_prize_rounds")
        .withIndex("by_key", (q) => q.eq("key", current.key))
        .first())
    )
      await ctx.db.insert("review_prize_rounds", {
        ...current,
        status: "open",
      });
    for (const r of await ctx.db.query("review_prize_rounds").collect())
      if (Date.now() > r.deadline && r.status === "open")
        await ctx.db.patch(r._id, { status: "judging_due" });
    await ctx.scheduler.runAfter(0, internal.reviewPrizeMail.processDue, {});
  },
});
export const mailCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("review_prize_rounds").collect();
    return rows
      .filter(
        (r) =>
          !r.paidAt &&
          r.status !== "closed_no_eligible_entries" &&
          ((r.winnerEntryId && !r.winnerNotifiedAt) ||
            (Date.now() > r.deadline &&
              r.reminderStage !==
                (Date.now() > r.payBy
                  ? "overdue"
                  : r.winnerEntryId
                    ? "payment_due"
                    : "judging_due"))) &&
          (r.mailNextAt ?? 0) <= Date.now(),
      )
      .map((r) => r._id);
  },
});
export const claimMail = internalMutation({
  args: { id: v.id("review_prize_rounds") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (
      !r ||
      r.paidAt ||
      r.status === "closed_no_eligible_entries" ||
      (r.mailLeaseUntil ?? 0) > Date.now() ||
      (r.mailNextAt ?? 0) > Date.now()
    )
      return null;
    const winner = !!r.winnerEntryId && !r.winnerNotifiedAt;
    const stage = winner
      ? "winner_notice"
      : Date.now() > r.payBy
        ? "overdue"
        : r.winnerEntryId
          ? "payment_due"
          : "judging_due";
    if (!winner && (Date.now() <= r.deadline || r.reminderStage === stage))
      return null;
    const entry = r.winnerEntryId ? await ctx.db.get(r.winnerEntryId) : null;
    const account = entry ? await ctx.db.get(entry.accountId) : null;
    const lease = Date.now() + 10 * 60000;
    await ctx.db.patch(id, {
      mailLeaseUntil: lease,
      mailAttempts: (r.mailAttempts ?? 0) + 1,
    });
    return {
      id,
      stage,
      lease,
      email: account?.email,
      deadline: r.deadline,
      payBy: r.payBy,
      key: r.key,
    };
  },
});
export const finishMail = internalMutation({
  args: {
    id: v.id("review_prize_rounds"),
    lease: v.number(),
    stage: v.string(),
    sent: v.boolean(),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.mailLeaseUntil !== a.lease) return;
    await ctx.db.patch(r._id, {
      mailLeaseUntil: undefined,
      mailNextAt: a.sent ? undefined : Date.now() + 60 * 60000,
      ...(a.sent
        ? a.stage === "winner_notice"
          ? { winnerNotifiedAt: Date.now() }
          : { reminderStage: a.stage }
        : {}),
    });
  },
});
