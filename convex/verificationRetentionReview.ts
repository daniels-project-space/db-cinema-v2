import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { bumpVerificationRetentionRevision, verificationRetentionRevision, verificationRetentionScopeKey } from "./lib/verificationRetentionRevision";

const PAGE_SIZE = 25;
const REASON_MIN = 10;
const REASON_MAX = 400;

async function adminRead(ctx: QueryCtx, token: string) {
  if (process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "verification:read");
    return;
  }
  if (!checkAdminToken(token)) throw Error("unauthorized");
}

async function adminWrite(ctx: MutationCtx, token: string, fn: string) {
  if (process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "verification:write");
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn });
    return;
  }
  await assertAdmin(ctx, token, fn);
}

async function actorHash(ctx: any) {
  const identity = await ctx.auth?.getUserIdentity?.();
  if (!identity || typeof identity.tokenIdentifier !== "string") return "legacy-admin";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.tokenIdentifier));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function audit(ctx: any, data: any) {
  await ctx.db.insert("verification_retention_audits", { ...data, createdAt: Date.now() });
}

function rentalClosedAt(booking: any): number | undefined {
  if (booking?.status === "returned") {
    const physicalReturn = booking.actualReturnedAt ?? booking.returnDecision?.actualReturnedAt;
    return physicalReturn ?? booking.returnedAt;
  }
  return booking?.status === "cancelled" ? booking.cancelledAt : undefined;
}

function validDate(value: unknown) {
  return Number.isFinite(value) && Number(value) > 0 && Number(value) <= Date.now();
}

async function archiveAndScope(ctx: any, archiveId: any) {
  const archive = await ctx.db.get(archiveId);
  if (!archive || archive.status === "deleted") throw Error("Verification archive unavailable.");
  const source = await ctx.db.get(archive.bookingId);
  const accountId = archive.accountId ?? source?.accountId;
  if (!accountId || (source?.accountId && source.accountId !== accountId)) throw Error("This archive has no verified account owner. Keep it protected and resolve its source record first.");
  const scopeKey = verificationRetentionScopeKey(accountId);
  return { archive, source, accountId, scopeKey, revision: await verificationRetentionRevision(ctx, scopeKey) };
}

async function latestReview(ctx: any, archiveId: any) {
  return await ctx.db.query("verification_archive_retention_reviews")
    .withIndex("by_archive", (q: any) => q.eq("archiveId", archiveId)).unique();
}

async function scheduleRun(ctx: any, archiveId: any, generation: number) {
  await ctx.scheduler.runAfter(0, internal.verificationRetentionReview.run, { archiveId, generation });
}

function blankJob(data: any) {
  return {
    ...data,
    state: "running",
    stage: "source",
    sourceCursor: undefined,
    linkCursor: undefined,
    rentalCursor: undefined,
    caseCursor: undefined,
    caseBookingId: undefined,
    sourceBookingId: undefined,
    missingBookingId: undefined,
    orphanLinkId: undefined,
    linkedRentals: 0,
    casesScanned: 0,
    activeRentals: 0,
    openCases: 0,
    unknownRentalStatuses: 0,
    unknownCaseStatuses: 0,
    closureNeedsReview: false,
    latestRentalClosureAt: undefined,
    latestCaseClosureAt: undefined,
    reviewDetails: undefined,
    error: undefined,
  };
}

async function addRental(ctx: any, archive: any, job: any, bookingId: any) {
  const existing = await ctx.db.query("verification_archive_retention_review_rentals")
    .withIndex("by_archive_generation_booking", (q: any) => q.eq("archiveId", archive._id).eq("generation", job.generation).eq("bookingId", bookingId)).unique();
  if (existing) return true;
  const booking = await ctx.db.get(bookingId);
  if (!booking) return false;
  const accountId = archive.accountId ?? (await ctx.db.get(archive.bookingId))?.accountId;
  if (!accountId || booking.accountId !== accountId) return false;
  await ctx.db.insert("verification_archive_retention_review_rentals", { archiveId: archive._id, generation: job.generation, bookingId, addedAt: Date.now() });
  let activeRentals = job.activeRentals, unknownRentalStatuses = job.unknownRentalStatuses;
  let closureNeedsReview = job.closureNeedsReview, latestRentalClosureAt = job.latestRentalClosureAt;
  if (["returned", "cancelled"].includes(booking.status)) {
    const closedAt = rentalClosedAt(booking);
    if (!validDate(closedAt)) closureNeedsReview = true;
    else latestRentalClosureAt = Math.max(latestRentalClosureAt ?? 0, closedAt!);
  } else if (["pending_payment", "pending_verification", "confirmed", "active"].includes(booking.status)) activeRentals++;
  else unknownRentalStatuses++;
  const changes = { linkedRentals: job.linkedRentals + 1, activeRentals, unknownRentalStatuses, closureNeedsReview, latestRentalClosureAt, updatedAt: Date.now() };
  await ctx.db.patch(job._id, changes);
  Object.assign(job, changes);
  return true;
}

async function resolveLink(ctx: any, archive: any, link: any, accountId: any) {
  const linked = await ctx.db.get(link.bookingId);
  if (linked) return linked.accountId === accountId ? linked : null;
  const resolution = await ctx.db.query("verification_archive_retention_links")
    .withIndex("by_orphan_link", (q: any) => q.eq("orphanLinkId", link._id)).unique();
  if (!resolution || resolution.archiveId !== archive._id || resolution.accountId !== accountId) return null;
  const replacement = await ctx.db.get(resolution.replacementBookingId);
  if (!replacement || replacement.accountId !== accountId) return null;
  if (replacement.verificationReusedFrom !== archive.bookingId && replacement.diditSessionId !== archive.sessionId) return null;
  if (resolution.caseId) {
    const selectedCase = await ctx.db.get(resolution.caseId);
    if (!selectedCase || selectedCase.bookingId !== replacement._id || selectedCase.accountId && selectedCase.accountId !== accountId) return null;
  }
  return replacement;
}

async function sourceForScan(ctx: any, archive: any, accountId: any) {
  const source = await ctx.db.get(archive.bookingId);
  if (source) return source.accountId === accountId ? source : null;
  const resolution = (await ctx.db.query("verification_archive_retention_links")
    .withIndex("by_archive_missing", (q: any) => q.eq("archiveId", archive._id).eq("missingBookingId", archive.bookingId)).take(101)).find((row: any) => !row.orphanLinkId);
  if (!resolution || resolution.orphanLinkId || resolution.accountId !== accountId) return null;
  const replacement = await ctx.db.get(resolution.replacementBookingId);
  if (!replacement || replacement.accountId !== accountId || (replacement.diditSessionId !== archive.sessionId && replacement.verificationReusedFrom !== archive.bookingId)) return null;
  if (resolution.caseId) {
    const selectedCase = await ctx.db.get(resolution.caseId);
    if (!selectedCase || selectedCase.bookingId !== replacement._id || selectedCase.accountId && selectedCase.accountId !== accountId) return null;
  }
  return replacement;
}

async function stopWithLink(ctx: any, job: any, archive: any, missingBookingId: any, orphanLinkId?: any) {
  const next = { ...job, state: "needs_link", missingBookingId, orphanLinkId, updatedAt: Date.now() };
  await ctx.db.patch(job._id, { state: next.state, missingBookingId, orphanLinkId, updatedAt: next.updatedAt });
  await audit(ctx, { archiveId: archive._id, accountId: job.accountId, generation: job.generation, event: "scan_needs_link", reason: "A referenced rental record is missing; an administrator must link the exact same-account rental.", actorHash: "system", missingBookingId, ...(orphanLinkId ? { orphanLinkId } : {}) });
}

async function stopWithAttention(ctx: any, job: any, reason: string) {
  await ctx.db.patch(job._id, { state: "attention", error: reason, updatedAt: Date.now() });
  await audit(ctx, { archiveId: job.archiveId, accountId: job.accountId, generation: job.generation, event: "scan_attention", reason, actorHash: "system" });
}

async function restartIfChanged(ctx: any, archive: any, job: any) {
  const revision = await verificationRetentionRevision(ctx, job.scopeKey);
  if (revision === job.revision) return false;
  const generation = job.generation + 1;
  const next = blankJob({ archiveId: archive._id, accountId: job.accountId, scopeKey: job.scopeKey, revision, generation, reason: "Rental or case history changed during review.", actorHash: "system", createdAt: Date.now(), updatedAt: Date.now() });
  await ctx.db.patch(job._id, next);
  await audit(ctx, { archiveId: archive._id, accountId: job.accountId, generation, event: "scan_restarted", reason: "Rental or case history changed during review; restarting from the first page.", actorHash: "system" });
  await scheduleRun(ctx, archive._id, generation);
  return true;
}

export const start = mutation({
  args: { token: v.string(), archiveId: v.id("verification_archives"), accountId: v.id("accounts"), reason: v.string() },
  handler: async (ctx, args) => {
    await adminWrite(ctx, args.token, "verificationRetentionReview.start");
    const { archive, source, accountId, scopeKey, revision } = await archiveAndScope(ctx, args.archiveId);
    if (accountId !== args.accountId) throw Error("This archive belongs to another account.");
    if (!source && !archive.accountId) throw Error("The missing source rental cannot be safely reconciled without an account link.");
    const reason = args.reason.trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw Error("Add a short reason (10–400 characters).");
    const existing = await latestReview(ctx, archive._id);
    if (existing?.state === "complete" && existing.revision === revision) return { state: "complete", generation: existing.generation };
    if (existing?.state === "running" && existing.revision === revision) return { state: "running", generation: existing.generation };
    if (existing?.state === "needs_link" && existing.revision === revision) return { state: "needs_link", generation: existing.generation };
    const actor = await actorHash(ctx), generation = (existing?.generation ?? 0) + 1, now = Date.now();
    const next = blankJob({ archiveId: archive._id, accountId, scopeKey, revision, generation, reason, actorHash: actor, createdAt: now, updatedAt: now });
    if (existing) await ctx.db.patch(existing._id, next);
    else {
      const id = await ctx.db.insert("verification_archive_retention_reviews", next);
      next._id = id;
    }
    await audit(ctx, { archiveId: archive._id, accountId, generation, event: "scan_started", reason, actorHash: actor });
    await scheduleRun(ctx, archive._id, generation);
    return { state: "running", generation };
  },
});

export const candidates = query({
  args: { token: v.string(), archiveId: v.id("verification_archives"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await adminRead(ctx, args.token);
    const { archive, accountId } = await archiveAndScope(ctx, args.archiveId);
    const job = await latestReview(ctx, archive._id);
    if (!job || job.state !== "needs_link" || job.revision !== await verificationRetentionRevision(ctx, job.scopeKey)) return { candidates: [], more: false, cursor: null };
    const page = await ctx.db.query("bookings").withIndex("by_account", (q: any) => q.eq("accountId", accountId)).order("desc").paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    const candidates = page.page.filter((booking: any) => booking.accountId === accountId && booking._id !== archive.bookingId &&
      (job.missingBookingId === archive.bookingId
        ? booking.diditSessionId === archive.sessionId || booking.verificationReusedFrom === archive.bookingId
        : booking.verificationReusedFrom === archive.bookingId || booking.diditSessionId === archive.sessionId));
    return {
      candidates: candidates.map((booking: any) => ({
        bookingId: booking._id,
        status: booking.status,
        title: booking.lineItems?.[0]?.title ?? "Rental",
        start: Array.isArray(booking.lineItems) && booking.lineItems.length ? Math.min(...booking.lineItems.map((item: any) => item.start).filter(Number.isFinite)) : null,
      })),
      more: !page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const repairLink = mutation({
  args: { token: v.string(), archiveId: v.id("verification_archives"), generation: v.number(), missingBookingId: v.id("bookings"), orphanLinkId: v.optional(v.id("verification_archive_links")), replacementBookingId: v.id("bookings"), caseId: v.optional(v.id("rental_damage_cases")), reason: v.string() },
  handler: async (ctx, args) => {
    await adminWrite(ctx, args.token, "verificationRetentionReview.repairLink");
    const { archive, accountId, scopeKey, revision } = await archiveAndScope(ctx, args.archiveId);
    const job = await latestReview(ctx, archive._id);
    if (!job || job.state !== "needs_link" || job.generation !== args.generation || job.revision !== revision || job.missingBookingId !== args.missingBookingId || job.orphanLinkId !== args.orphanLinkId) throw Error("The retention case changed. Refresh and review the current link.");
    if (args.missingBookingId !== archive.bookingId && !args.orphanLinkId) throw Error("The missing rental does not belong to this archive.");
    if (args.orphanLinkId) {
      const orphan = await ctx.db.get(args.orphanLinkId);
      if (!orphan || orphan.sourceBookingId !== archive.bookingId || orphan.bookingId !== args.missingBookingId || await ctx.db.get(orphan.bookingId)) throw Error("This missing rental link changed. Refresh before repairing it.");
    } else if (await ctx.db.get(args.missingBookingId)) throw Error("The rental now exists. Restart the history scan instead.");
    const target = await ctx.db.get(args.replacementBookingId);
    if (!target || target.accountId !== accountId || (target.verificationReusedFrom !== archive.bookingId && target.diditSessionId !== archive.sessionId)) throw Error("Choose the exact existing rental from this account and verification.");
    if (args.caseId) {
      const rentalCase = await ctx.db.get(args.caseId);
      if (!rentalCase || rentalCase.bookingId !== target._id || rentalCase.accountId && rentalCase.accountId !== accountId || !["open", "closed"].includes(rentalCase.status)) throw Error("Choose a case from the selected rental and account.");
    }
    const reason = args.reason.trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw Error("Add a short reason (10–400 characters).");
    const existing = args.orphanLinkId
      ? await ctx.db.query("verification_archive_retention_links").withIndex("by_orphan_link", (q: any) => q.eq("orphanLinkId", args.orphanLinkId)).unique()
      : await ctx.db.query("verification_archive_retention_links").withIndex("by_archive_missing", (q: any) => q.eq("archiveId", archive._id).eq("missingBookingId", args.missingBookingId)).unique();
    if (existing) {
      if (existing.replacementBookingId === target._id && existing.caseId === args.caseId) return { linked: true };
      throw Error("A different rental is already linked to this missing record. Keep documents protected and ask an administrator to review the saved audit.");
    }
    const actor = await actorHash(ctx);
    await ctx.db.insert("verification_archive_retention_links", { archiveId: archive._id, accountId, missingBookingId: args.missingBookingId, ...(args.orphanLinkId ? { orphanLinkId: args.orphanLinkId } : {}), replacementBookingId: target._id, ...(args.caseId ? { caseId: args.caseId } : {}), reason, revision, actorHash: actor, createdAt: Date.now() });
    await bumpVerificationRetentionRevision(ctx, target);
    const nextRevision = await verificationRetentionRevision(ctx, scopeKey), generation = job.generation + 1, now = Date.now();
    const next = blankJob({ archiveId: archive._id, accountId, scopeKey, revision: nextRevision, generation, reason: "History link repaired by administrator.", actorHash: actor, createdAt: now, updatedAt: now });
    await ctx.db.patch(job._id, next);
    await audit(ctx, { archiveId: archive._id, accountId, generation, event: "history_linked", reason, actorHash: actor, missingBookingId: args.missingBookingId, ...(args.orphanLinkId ? { orphanLinkId: args.orphanLinkId } : {}), replacementBookingId: target._id, ...(args.caseId ? { caseId: args.caseId } : {}) });
    await scheduleRun(ctx, archive._id, generation);
    return { linked: true, generation };
  },
});

async function collectStep(ctx: any, archive: any, job: any) {
  const source = await sourceForScan(ctx, archive, job.accountId);
  if (!source) {
    if (!await ctx.db.get(archive.bookingId) && !(await ctx.db.query("verification_archive_retention_links").withIndex("by_archive_missing", (q: any) => q.eq("archiveId", archive._id).eq("missingBookingId", archive.bookingId)).take(101)).some((row: any) => !row.orphanLinkId)) {
      await stopWithLink(ctx, job, archive, archive.bookingId);
      return;
    }
    await stopWithAttention(ctx, job, "The archive source does not match its account or session. Keep the documents protected.");
    return;
  }
  if (job.stage === "source") {
    if (!await addRental(ctx, archive, job, source._id)) {
      await stopWithAttention(ctx, job, "The source rental could not be linked to this account.");
      return;
    }
    await ctx.db.patch(job._id, { stage: "reused", sourceBookingId: archive.bookingId, updatedAt: Date.now() });
    return;
  }
  if (job.stage === "reused") {
    const page = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", archive.bookingId)).order("asc").paginate({ cursor: job.sourceCursor ?? null, numItems: PAGE_SIZE, maximumRowsRead: PAGE_SIZE });
    for (const booking of page.page) {
      if (booking.accountId !== job.accountId || !await addRental(ctx, archive, job, booking._id)) {
        await stopWithAttention(ctx, job, "A reused rental has inconsistent account ownership. Keep the documents protected.");
        return;
      }
    }
    if (page.isDone) await ctx.db.patch(job._id, { stage: "links", sourceCursor: undefined, updatedAt: Date.now() });
    else await ctx.db.patch(job._id, { sourceCursor: page.continueCursor, updatedAt: Date.now() });
    return;
  }
  if (job.stage === "links") {
    const page = await ctx.db.query("verification_archive_links").withIndex("by_source_booking", (q: any) => q.eq("sourceBookingId", archive.bookingId)).order("asc").paginate({ cursor: job.linkCursor ?? null, numItems: PAGE_SIZE, maximumRowsRead: PAGE_SIZE });
    for (const link of page.page) {
      const target = await resolveLink(ctx, archive, link, job.accountId);
      if (!target) {
        await stopWithLink(ctx, job, archive, link.bookingId, link._id);
        return;
      }
      if (!await addRental(ctx, archive, job, target._id)) {
        await stopWithAttention(ctx, job, "A linked rental has inconsistent account ownership. Keep the documents protected.");
        return;
      }
    }
    if (page.isDone) await ctx.db.patch(job._id, { stage: "cases", linkCursor: undefined, rentalCursor: undefined, caseCursor: undefined, caseBookingId: undefined, updatedAt: Date.now() });
    else await ctx.db.patch(job._id, { linkCursor: page.continueCursor, updatedAt: Date.now() });
    return;
  }
  if (job.stage === "cases") {
    let caseBookingId = job.caseBookingId;
    let rentalCursor = job.rentalCursor;
    if (!caseBookingId) {
      const rentalPage = await ctx.db.query("verification_archive_retention_review_rentals").withIndex("by_archive_generation", (q: any) => q.eq("archiveId", archive._id).eq("generation", job.generation)).order("asc").paginate({ cursor: rentalCursor ?? null, numItems: 1, maximumRowsRead: 1 });
      if (!rentalPage.page.length) {
        await ctx.db.patch(job._id, { stage: "done", rentalCursor: undefined, updatedAt: Date.now() });
        return;
      }
      caseBookingId = rentalPage.page[0].bookingId;
      rentalCursor = rentalPage.continueCursor;
    }
    const page = await ctx.db.query("rental_damage_cases").withIndex("by_booking", (q: any) => q.eq("bookingId", caseBookingId)).order("asc").paginate({ cursor: job.caseCursor ?? null, numItems: PAGE_SIZE, maximumRowsRead: PAGE_SIZE });
    let casesScanned = job.casesScanned, openCases = job.openCases, unknownCaseStatuses = job.unknownCaseStatuses;
    let closureNeedsReview = job.closureNeedsReview, latestCaseClosureAt = job.latestCaseClosureAt, reviewDetails = job.reviewDetails;
    for (const rentalCase of page.page) {
      casesScanned++;
      if (rentalCase.accountId && rentalCase.accountId !== job.accountId) {
        await stopWithAttention(ctx, job, "A case record has inconsistent account ownership. Keep the documents protected.");
        return;
      }
      if (rentalCase.status === "open") openCases++;
      else if (rentalCase.status === "closed") {
        if (!validDate(rentalCase.openedAt) || !validDate(rentalCase.closedAt) || rentalCase.closedAt < rentalCase.openedAt) {
          closureNeedsReview = true;
          reviewDetails ??= { bookingId: caseBookingId, caseId: rentalCase._id, openedAt: Number.isFinite(rentalCase.openedAt) ? rentalCase.openedAt : null, closedAt: Number.isFinite(rentalCase.closedAt) ? rentalCase.closedAt : null };
        } else latestCaseClosureAt = Math.max(latestCaseClosureAt ?? 0, rentalCase.closedAt);
      } else unknownCaseStatuses++;
    }
    await ctx.db.patch(job._id, { casesScanned, openCases, unknownCaseStatuses, closureNeedsReview, latestCaseClosureAt, reviewDetails, caseBookingId: page.isDone ? undefined : caseBookingId, caseCursor: page.isDone ? undefined : page.continueCursor, rentalCursor, updatedAt: Date.now() });
    return;
  }
}

export const run = internalMutation({ args: { archiveId: v.id("verification_archives"), generation: v.number() }, handler: async (ctx, args) => {
  const job = await latestReview(ctx, args.archiveId), archive = await ctx.db.get(args.archiveId);
  if (!job || !archive || job.state !== "running" || job.generation !== args.generation || archive.status === "deleted") return;
  if (await restartIfChanged(ctx, archive, job)) return;
  if (job.stage !== "done") {
    await collectStep(ctx, archive, job);
    const latest = await latestReview(ctx, archive._id);
    if (latest?.state === "running" && latest.generation === args.generation) await scheduleRun(ctx, archive._id, args.generation);
    return;
  }
  if (await restartIfChanged(ctx, archive, job)) return;
  if (job.unknownRentalStatuses || job.unknownCaseStatuses) {
    await stopWithAttention(ctx, job, "History contains a rental or case status that cannot be interpreted safely.");
    return;
  }
  await ctx.db.patch(job._id, { state: "complete", updatedAt: Date.now() });
  await audit(ctx, { archiveId: archive._id, accountId: job.accountId, generation: job.generation, event: "scan_completed", reason: "All linked rentals and cases were checked against current account history.", actorHash: "system" });
} });

export async function retentionReviewSnapshot(ctx: any, archive: any) {
  const job = await latestReview(ctx, archive._id);
  if (!job || job.state !== "complete") return null;
  const scopeKey = verificationRetentionScopeKey(archive.accountId ?? job.accountId);
  if (job.scopeKey !== scopeKey || job.revision !== await verificationRetentionRevision(ctx, scopeKey)) return null;
  return job;
}

export async function retentionReviewStatus(ctx: any, archive: any) {
  const job = await latestReview(ctx, archive._id);
  if (!job) return null;
  const revision = await verificationRetentionRevision(ctx, job.scopeKey);
  return { state: job.revision === revision ? job.state : "stale", generation: job.generation, stage: job.stage, linkedRentals: job.linkedRentals, casesScanned: job.casesScanned, activeRentals: job.activeRentals, openCases: job.openCases, ...(job.missingBookingId ? { missingBookingId: job.missingBookingId } : {}), ...(job.orphanLinkId ? { orphanLinkId: job.orphanLinkId } : {}), ...(job.error ? { error: job.error } : {}) };
}
