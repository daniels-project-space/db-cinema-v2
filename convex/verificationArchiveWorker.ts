"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHash } from "node:crypto";

export function documentMedia(report: any): { kind: string; url: string }[] {
  const media: { kind: string; url: string }[] = [];
  for (const [i, row] of (report.id_verifications ?? []).entries()) {
    for (const field of ["front_image", "back_image", "full_front_image", "full_back_image"])
      if (typeof row[field] === "string" && row[field]) media.push({ kind: `identity-${i}-${field}`, url: row[field] });
  }
  for (const [i, row] of (report.poa_verifications ?? []).entries())
    if (typeof row.document_file === "string" && row.document_file) media.push({ kind: `address-${i}`, url: row.document_file });
  return media;
}
export function trustedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (host.endsWith(".didit.me") || host.endsWith(".cloudfront.net") || /^[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host) || host.endsWith(".r2.cloudflarestorage.com") || (process.env.DIDIT_ARCHIVE_MEDIA_HOSTS ?? "").split(",").map(h => h.trim()).filter(Boolean).includes(host));
  } catch { return false; }
}
export const capture = internalAction({ args: { archiveId: v.id("verification_archives") }, handler: async (ctx, { archiveId }) => {
  const archive = await ctx.runQuery(internal.verificationArchive.context, { archiveId });
  if (!archive || archive.status === "complete" || archive.status === "deleted") return;
  let complete = false;
  try {
    const key = process.env.DIDIT_API_KEY;
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(archive.sessionId)) throw Error("Provider configuration unavailable");
    const response = await fetch(`https://verification.didit.me/v3/session/${archive.sessionId}/decision/`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error("Provider decision unavailable");
    const report = await response.json();
    if (report.session_id !== archive.sessionId || report.vendor_data !== `dbc-booking-${archive.bookingId}` || report.contact_details?.email?.trim().toLowerCase() !== archive.email.trim().toLowerCase() || report.workflow_id !== process.env.DIDIT_WORKFLOW_ID || report.session_kind !== "user") throw Error("Verification case mismatch");
    const media = documentMedia(report);
    if (!media.some(m => m.kind.startsWith("identity-")) || !media.some(m => m.kind.startsWith("address-")) || media.length > 30) throw Error("Required documents missing");
    for (const file of media) {
      if (!trustedMediaUrl(file.url)) throw Error("Unapproved provider media host");
      // Never follow arbitrary redirects or expose provider URLs in public queries.
      const downloaded = await fetch(file.url, { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!downloaded.ok) throw Error("Document download failed");
      const declaredSize = Number(downloaded.headers.get("content-length") ?? 0);
      if (declaredSize > 15 * 1024 * 1024) throw Error("Document exceeds limit");
      const reader = downloaded.body?.getReader();
      if (!reader) throw Error("Empty document");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 15 * 1024 * 1024) { await reader.cancel(); throw Error("Document exceeds limit"); } chunks.push(value); }
      const bytes = Buffer.concat(chunks);
      const type = bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
      if (!type) throw Error("Unexpected document format");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const previous = archive.documents.find(d => d.kind === file.kind && d.sha256 === sha256);
      if (previous) {
        const stored = await ctx.storage.get(previous.storageId);
        if (stored && stored.size === size && createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex") === sha256) continue;
      }
      const storageId = await ctx.storage.store(new Blob([bytes], { type }));
      try {
        const stored = await ctx.storage.get(storageId);
        if (!stored || stored.size !== size || createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex") !== sha256) throw Error("Stored document integrity check failed");
        await ctx.runMutation(internal.verificationArchive.save, { archiveId, kind: file.kind, storageId, sha256, size, contentType: type, ...(previous ? { replaceStorageId: previous.storageId } : {}) });
      }
      catch (error) { await ctx.storage.delete(storageId); throw error; }
    }
    complete = true;
  } catch { /* Persist a bounded, non-sensitive failure; cron/admin retries fetch fresh URLs. */ }
  await ctx.runMutation(internal.verificationArchive.finish, { archiveId, complete });
} });
export const retryDue = internalAction({ args: {}, handler: async ctx => {
  const jobs = await ctx.runQuery(internal.verificationArchive.due, {});
  for (const job of jobs) await ctx.runAction(internal.verificationArchiveWorker.capture, { archiveId: job._id });
} });
