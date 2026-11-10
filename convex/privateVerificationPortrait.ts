import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { accountVerificationReady } from "./lib/accountVerificationReady";
import { archiveRetention, documentCopyAvailable } from "./verificationArchive";
import { CURRENT_PRIVACY_NOTICE_VERSION } from "../shared/legalVersioning";

const NOTICE_VERSION = CURRENT_PRIVACY_NOTICE_VERSION;

async function portraitAdminRead(ctx: any, token: string): Promise<boolean> {
  if (process.env.ADMIN_SESSION_VERIFICATION_V2 !== "enabled") return checkAdminToken(token);
  if (!adminSessionMigrationReady()) return false;
  try { await assertAdminScopeSession(ctx, token, "verification:read"); return true; } catch { return false; }
}

async function accountForSession(ctx: any, token: string, requireExpiry = false) {
  const session = await ctx.db.query("sessions").withIndex("by_token", (q: any) => q.eq("token", token)).first();
  if (!session || (requireExpiry && !Number.isFinite(session.expiresAt)) || (session.expiresAt != null && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()))) return null;
  const account = await ctx.db.get(session.accountId);
  return account;
}

function canGrantConsent(account: any) {
  return account.blockedAt == null && !(account.emailVerificationRequired && !account.emailVerifiedAt);
}

export const availability = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => process.env.PRIVATE_VERIFICATION_PHOTO_ENABLED === "true" && await portraitAdminRead(ctx, token),
});

export const preference = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountForSession(ctx, token);
    if (!account) return null;
    const allowed = account.privateVerificationPortraitConsentVersion === NOTICE_VERSION && Number.isSafeInteger(account.privateVerificationPortraitConsentedAt);
    const previousConsent = typeof account.privateVerificationPortraitConsentVersion === "string";
    const canAllow = canGrantConsent(account) && process.env.PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED === "true" && !!await accountForSession(ctx, token, true);
    if (!canAllow && !previousConsent) return null;
    return { allowed, previousConsent, canAllow, noticeVersion: NOTICE_VERSION, revision: account.privateVerificationPortraitPreferenceRevision ?? 0 };
  },
});

export const onboarding = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountForSession(ctx, token, true);
    const now = Date.now();
    if (!account || process.env.PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED !== "true" || !canGrantConsent(account) ||
      !Number.isSafeInteger(account.createdAt) || account.createdAt > now || now - account.createdAt >= 86400000 ||
      account.avatarStorageId || account.googleAvatarUrl || account.privateVerificationPortraitPromptVersion === NOTICE_VERSION ||
      account.privateVerificationPortraitConsentVersion === NOTICE_VERSION) return null;
    return { noticeVersion: NOTICE_VERSION, revision: account.privateVerificationPortraitPreferenceRevision ?? 0 };
  },
});

export const setPreference = mutation({
  args: { token: v.string(), allowed: v.boolean(), noticeVersion: v.string(), expectedRevision: v.number() },
  handler: async (ctx, { token, allowed, noticeVersion, expectedRevision }) => {
    const account = await accountForSession(ctx, token, allowed);
    if (!account) throw new Error("Please sign in to change this setting.");
    const revision = account.privateVerificationPortraitPreferenceRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(expectedRevision) || expectedRevision !== revision || revision >= Number.MAX_SAFE_INTEGER) throw new Error("This setting changed. Refresh and try again.");
    if (allowed && (!canGrantConsent(account) || process.env.PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED !== "true" || noticeVersion !== NOTICE_VERSION)) throw new Error("Please review the current notice before allowing this setting.");
    if (!allowed) {
      await ctx.db.patch(account._id, { privateVerificationPortraitNoticeVersion: undefined, privateVerificationPortraitNotifiedAt: undefined, privateVerificationPortraitConsentVersion: undefined, privateVerificationPortraitConsentedAt: undefined, privateVerificationPortraitPreferenceRevision: revision + 1, ...(noticeVersion === NOTICE_VERSION ? { privateVerificationPortraitPromptVersion: NOTICE_VERSION } : {}) });
    } else if (account.privateVerificationPortraitConsentVersion !== NOTICE_VERSION || !Number.isSafeInteger(account.privateVerificationPortraitConsentedAt)) {
      const now = Date.now();
      await ctx.db.patch(account._id, { privateVerificationPortraitNoticeVersion: NOTICE_VERSION, privateVerificationPortraitNotifiedAt: now, privateVerificationPortraitConsentVersion: NOTICE_VERSION, privateVerificationPortraitConsentedAt: now, privateVerificationPortraitPreferenceRevision: revision + 1, privateVerificationPortraitPromptVersion: NOTICE_VERSION });
    }
  },
});

export const selected = query({
  args: { token: v.string(), accountId: v.id("accounts"), refresh: v.number() },
  handler: async (ctx, args) => {
    if (!await portraitAdminRead(ctx, args.token)) return null;
    const now = Date.now();
    if (process.env.PRIVATE_VERIFICATION_PHOTO_ENABLED !== "true" || !Number.isSafeInteger(args.refresh)) return null;
    const account = await ctx.db.get(args.accountId);
    if (!account || account.privateVerificationPortraitNoticeVersion !== NOTICE_VERSION || account.privateVerificationPortraitConsentVersion !== NOTICE_VERSION || !Number.isSafeInteger(account.privateVerificationPortraitNotifiedAt) || account.privateVerificationPortraitNotifiedAt! <= 0 || account.privateVerificationPortraitNotifiedAt! > now || !Number.isSafeInteger(account.privateVerificationPortraitConsentedAt) || account.privateVerificationPortraitConsentedAt! < account.privateVerificationPortraitNotifiedAt! || account.privateVerificationPortraitConsentedAt! > now || !Number.isSafeInteger(account.createdAt) || now < account.createdAt + 86400000 || account.avatarStorageId || account.googleAvatarUrl) return null;
    if (!await accountVerificationReady(ctx, account)) return null;
    const source = await ctx.db.get(account.rentalVerification!.sourceBookingId);
    if (!source || source.accountId !== account._id || !source.diditSessionId) return null;
    const archives = await ctx.db.query("verification_archives").withIndex("by_booking", q => q.eq("bookingId", source._id)).take(11);
    if (archives.length > 10) return null;
    for (const archive of archives) {
      if (archive.accountId !== account._id || archive.sessionId !== source.diditSessionId || archive.source === "drone" || archive.status !== "complete" || !(await archiveRetention(ctx, archive)).viewable) continue;
      const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).take(31);
      if (documents.length > 30) return null;
      for (const document of documents) {
        if (/^selfie-\d+-reference_image$/.test(document.kind) && ["image/jpeg", "image/png", "image/webp"].includes(document.contentType) && await documentCopyAvailable(ctx, archive, document))
          return { documentId: document._id };
      }
    }
    return null;
  },
});
