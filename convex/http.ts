import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { droneDocumentType, DRONE_DOCUMENT_LIMIT } from "./lib/droneDocument";
import { chatAttachmentsReady, chatAttachmentScannerHealthy, scanChatAttachment, CHAT_ATTACHMENT_LIMIT, ChatAttachmentRejectedError, ChatAttachmentScannerUnavailableError } from "./lib/chatAttachmentScanner";
import { chatAttachmentName } from "./lib/chatAttachmentName";
import { adminSessionMigrationReady } from "./adminAccountSessionV2";
import { CHAT_TEXT_LIMIT, isChatAttachmentNameMatched, isChatAttachmentType, isChatImageType } from "../shared/chatAttachmentPolicy";
import { RETURN_EVIDENCE_DOWNLOAD_TTL_MS, returnEvidenceRecipientHash, signReturnEvidenceLink, verifyReturnEvidenceLink } from "../shared/returnEvidenceLink";

const http = httpRouter();

function returnEvidenceHtmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function returnEvidenceDigest(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function returnEvidenceBytesDigest(value: Uint8Array) {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function returnEvidenceHeaders(contentType: string) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  };
}

function returnEvidencePage(title: string, body: string) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${returnEvidenceHtmlEscape(title)}</title><body style="margin:0;background:#111;color:#f4efe8;font:16px/1.5 Arial,sans-serif"><main style="max-width:620px;margin:10vh auto;padding:28px;border:1px solid #67513d;border-radius:16px;background:#191817"><p style="margin:0 0 12px;color:#c89972;font-size:12px;letter-spacing:.16em">DB CINEMA RENTALS</p><h1 style="margin:0 0 18px;font:28px/1.2 Georgia,serif">${returnEvidenceHtmlEscape(title)}</h1>${body}</main></body></html>`, { status: 200, headers: returnEvidenceHeaders("text/html; charset=utf-8") });
}

function returnEvidenceSiteUrl() {
  const value = process.env.CONVEX_SITE_URL?.trim();
  if (!value) throw Error("Return evidence delivery is unavailable.");
  const site = new URL(value);
  if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash) throw Error("Return evidence delivery is unavailable.");
  return site;
}

function returnEvidencePath(site: URL) {
  const target = new URL(site);
  target.pathname = `${site.pathname.replace(/\/$/, "")}/return-evidence`;
  target.search = "";
  target.hash = "";
  return target;
}

async function readBoundedReturnEvidenceBody(request: Request, maximumBytes: number): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

http.route({ path: "/return-evidence", method: "GET", handler: httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const downloadToken = url.searchParams.get("download");
  const token = downloadToken ?? url.searchParams.get("token");
  const secret = process.env.RETURN_EVIDENCE_LINK_SECRET?.trim() || process.env.INVOICE_SECRET?.trim() || "";
  if (!token || token.length > 4096 || secret.length < 24) return new Response("Evidence link unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
  const claims = await verifyReturnEvidenceLink(token, secret);
  if (!claims) return new Response("Evidence link expired or unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
  const evidence: any = await ctx.runQuery(internal.bookings.returnEvidenceLinkFiles, {
    bookingId: claims.bookingId as any,
    caseId: claims.caseId as any,
    expiresAt: claims.expiresAt,
    recipientHash: claims.recipientHash,
    ...(claims.downloadExpiresAt !== undefined ? { downloadExpiresAt: claims.downloadExpiresAt } : {}),
    ...(claims.fileIndex !== undefined ? { fileIndex: claims.fileIndex } : {}),
  });
  if (!evidence) return new Response("Evidence link expired or unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });

  if (downloadToken) {
    if (claims.fileIndex === undefined || claims.downloadExpiresAt === undefined || !evidence.storageId || !evidence.sha256) return new Response("Evidence unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
    const blob = await ctx.storage.get(evidence.storageId as any);
    if (!blob || blob.size !== evidence.size) return new Response("Evidence unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const actualHash = await returnEvidenceBytesDigest(bytes);
    if (actualHash !== evidence.sha256) return new Response("Evidence unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
    let filename: string;
    try { filename = chatAttachmentName(evidence.name, evidence.contentType); }
    catch { return new Response("Evidence unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") }); }
    const headers = returnEvidenceHeaders(evidence.contentType);
    return new Response(bytes, { status: 200, headers: { ...headers, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } });
  }

  if (claims.fileIndex !== undefined || claims.downloadExpiresAt !== undefined) return new Response("Evidence unavailable", { status: 404, headers: returnEvidenceHeaders("text/plain; charset=utf-8") });
  const actionUrl = returnEvidencePath(returnEvidenceSiteUrl());
  actionUrl.searchParams.set("token", token);
  return returnEvidencePage("View return evidence", `<p>For privacy, confirm the email address used for this rental before viewing the damage photos.</p><form method="post" action="${returnEvidenceHtmlEscape(actionUrl.toString())}"><label for="email">Rental email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" style="display:block;box-sizing:border-box;width:100%;margin:8px 0 16px;padding:12px;border:1px solid #67513d;border-radius:8px;background:#111;color:#f4efe8"><button style="border:0;border-radius:8px;padding:12px 18px;background:#bd8a62;color:#111;font-weight:700">Continue securely</button></form><p style="color:#aaa;font-size:13px">This private link expires after 30 days. File downloads expire after 15 minutes.</p>`);
}) });

http.route({ path: "/return-evidence", method: "POST", handler: httpAction(async (ctx, request) => {
  const headers = returnEvidenceHeaders("text/html; charset=utf-8");
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return new Response("Invalid request", { status: 415, headers });
  let raw: string | null;
  try { raw = await readBoundedReturnEvidenceBody(request, 1024); }
  catch { raw = null; }
  if (raw === null) return new Response("Invalid request", { status: 413, headers });
  const form = new URLSearchParams(raw);
  const email = form.get("email")?.trim() ?? "";
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const secret = process.env.RETURN_EVIDENCE_LINK_SECRET?.trim() || process.env.INVOICE_SECRET?.trim() || "";
  if (!token || token.length > 4096 || !email || email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) || secret.length < 24)
    return new Response("Evidence link unavailable", { status: 404, headers });
  const claims = await verifyReturnEvidenceLink(token, secret);
  if (!claims || claims.fileIndex !== undefined || claims.downloadExpiresAt !== undefined) return new Response("Evidence link expired or unavailable", { status: 404, headers });
  const tokenHash = await returnEvidenceDigest(token);
  const allowed = await ctx.runMutation(internal.bookings.returnEvidenceAccessAttempt, { tokenHash });
  if (!allowed) return new Response("Too many attempts. Try again tomorrow.", { status: 429, headers: { ...headers, "Retry-After": "86400" } });
  if (await returnEvidenceRecipientHash(email, secret) !== claims.recipientHash) return returnEvidencePage("Could not confirm this rental", `<p>The email address did not match this rental. Check it and try again, or reply to the return email for help.</p>`);
  const evidence = await ctx.runQuery(internal.bookings.returnEvidenceLinkFiles, {
    bookingId: claims.bookingId as any, caseId: claims.caseId as any, expiresAt: claims.expiresAt, recipientHash: claims.recipientHash,
  });
  if (!evidence || !Array.isArray(evidence.files) || !evidence.files.length || evidence.files.length > 5) return new Response("Evidence link expired or unavailable", { status: 404, headers });
  const site = returnEvidencePath(returnEvidenceSiteUrl());
  const expiresAt = Math.min(claims.expiresAt, Date.now() + RETURN_EVIDENCE_DOWNLOAD_TTL_MS);
  const links = await Promise.all(evidence.files.map(async (file: any, fileIndex: number) => {
    const download = await signReturnEvidenceLink({ ...claims, fileIndex, downloadExpiresAt: expiresAt }, secret);
    const target = new URL(site);
    target.searchParams.set("download", download);
    return `<li style="margin:12px 0"><span>${returnEvidenceHtmlEscape(file.name)}</span> <span style="color:#aaa">(${Math.ceil(file.size / 1024)} KB)</span> · <a href="${returnEvidenceHtmlEscape(target.toString())}" style="color:#d3a77f">Download photo</a></li>`;
  }));
  return returnEvidencePage("Damage evidence", `<p>These photos were recorded for <strong>${returnEvidenceHtmlEscape(evidence.itemTitle)}</strong> during your rental return. The links below are private and expire after 15 minutes.</p><ul>${links.join("")}</ul><p style="color:#aaa;font-size:13px">If a download link expires, reopen the original email link and confirm your rental email again.</p>`);
}) });

// Rental Manager → storefront marketing tags. The shared secret is the same
// server-to-server credential used for the existing Rental Manager reads.
http.route({
  path: "/dbcinema/manager-marketing-tags",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const expected = process.env.RMV2_WEBHOOK_SECRET ?? "";
    const supplied = req.headers.get("x-dbcinema-sync-token") ?? "";
    if (!expected || supplied.length !== expected.length || supplied !== expected)
      return new Response("Forbidden", { status: 403, headers });
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return new Response("Unsupported media type", { status: 415, headers });

    let body: any;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).byteLength > 16_384)
        return new Response("Request too large", { status: 413, headers });
      body = JSON.parse(raw);
    } catch { return new Response("Invalid JSON", { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "protocolVersion" && key !== "changes") ||
        body.protocolVersion !== 1 || !Array.isArray(body.changes) ||
        body.changes.length < 1 || body.changes.length > 50 ||
        body.changes.some((change: any) => !change || typeof change !== "object" || Array.isArray(change) ||
          Object.keys(change).some(key => !["productId", "marketingOnly", "mode", "updatedAt"].includes(key)) ||
          !Number.isSafeInteger(change.productId) || change.productId <= 0 ||
          typeof change.marketingOnly !== "boolean" || !["automatic", "manual"].includes(change.mode) ||
          !Number.isSafeInteger(change.updatedAt) || change.updatedAt < 0) ||
        new Set(body.changes.map((change: any) => change.productId)).size !== body.changes.length)
      return new Response("Invalid marketing tag batch", { status: 400, headers });

    try {
      const receipt = await ctx.runMutation(internal.sync.applyManagerMarketingTags, { changes: body.changes });
      return Response.json(receipt, { headers });
    } catch {
      return new Response("Marketing tag update failed", { status: 500, headers });
    }
  }),
});

function documentCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = new Set([process.env.APP_URL?.replace(/\/$/, ""), "https://dbcinemarentals.com", "https://www.dbcinemarentals.com", "https://db-cinema-v2.vercel.app"]);
  return allowed.has(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Checkout-Session, X-Chat-Filename, X-DBC-Admin-Session", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" } : null;
}
function adminHttpToken(req: Request, scoped: boolean): string {
  const authorization = req.headers.get("authorization") ?? "";
  if (!scoped) return authorization.replace(/^Bearer /, "");
  const token = req.headers.get("x-dbc-admin-session") ?? "";
  if (!/^Bearer [^\s]+$/.test(authorization) || !/^[a-f0-9]{64}$/.test(token)) throw Error("unauthorized");
  return token;
}
http.route({ path: "/admin-session", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-session", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (!adminSessionMigrationReady()) return new Response("Admin session unavailable", { status: 503, headers });
  if (!/^Bearer [^\s]+$/.test(req.headers.get("authorization") ?? "") ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? ""))
    return new Response("Unauthorized", { status: 401, headers });
  try {
    if (Number(req.headers.get("content-length")) > 1024) return new Response("Invalid request", { status: 400, headers });
    const reader = req.body?.getReader();
    if (!reader) return new Response("Invalid request", { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 1024) { await reader.cancel(); return new Response("Invalid request", { status: 400, headers }); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 4 ||
        !["clientDigest", "nonce", "mac"].every(key => typeof body[key] === "string" && /^[a-f0-9]{64}$/.test(body[key])) ||
        !Number.isSafeInteger(body.issuedAt)) return new Response("Invalid request", { status: 400, headers });
    const result = await ctx.runAction(internal.adminSessionIssuerV2.issue, { attestation: body });
    if (!result) return new Response("Unauthorized", { status: 401, headers });
    return Response.json(result, { headers });
  } catch { return new Response("Unauthorized", { status: 401, headers }); }
}) });
http.route({ path: "/renter-avatar", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/renter-avatar", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const { accountId, revision } = await ctx.runMutation(internal.accounts.reserveAvatarUpload, { token });
    const limit = 5 * 1024 * 1024;
    if (Number(req.headers.get("content-length")) > limit) throw Error("Image too large.");
    const reader = req.body?.getReader();
    if (!reader) throw Error("Missing image.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { await reader.cancel(); throw Error("Image too large."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const type = droneDocumentType(bytes, req.headers.get("content-type") ?? "");
    if (!type.startsWith("image/")) throw Error("Please choose an image.");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
    const parts: ArrayBuffer[] = [];
    for (let start = 0; start < bytes.length; start += 512 * 1024) parts.push(bytes.slice(start, start + 512 * 1024).buffer);
    await ctx.runMutation(internal.accounts.commitAvatarUpload, { token, accountId, revision, contentType: type, digest, chunks: parts });
    return Response.json({ ok: true }, { headers });
  } catch {
    return new Response("Photo could not be uploaded. Choose a JPG, PNG or WebP up to 5 MB.", { status: 403, headers });
  }
}) });
http.route({ path: "/signup-avatar", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/signup-avatar", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors=documentCors(req);
  if(!cors)return new Response("Forbidden",{status:403});
  const headers={...cors,"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
  try{
    const token=req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("Invalid request.");
    const hash=await returnEvidenceDigest(token);
    if(new URL(req.url).searchParams.get("preview")==="1"){
      const storageId=await ctx.runQuery(internal.accountCodeClaims.pendingAvatar,{setupHash:hash});
      if(!storageId)return new Response(null,{status:404,headers});
      const photo=await ctx.storage.get(storageId);
      if(!photo)return new Response(null,{status:404,headers});
      return new Response(photo,{headers:{...headers,"Content-Type":photo.type,"Content-Security-Policy":"default-src 'none'; sandbox"}});
    }
    const leaseKey=crypto.randomUUID();
    if(!await ctx.runMutation(internal.accountCodeClaims.reserveAvatar,{challengeHash:hash,leaseKey}))return Response.json({ok:true},{headers});
    try{
    const limit=5*1024*1024;
    if(Number(req.headers.get("content-length"))>limit)throw Error("Image too large.");
    const reader=req.body?.getReader();if(!reader)throw Error("Missing image.");
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw Error("Image too large.");}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const contentType=droneDocumentType(bytes,req.headers.get("content-type")??"");
    if(!contentType.startsWith("image/"))throw Error("Invalid image.");
    const parts:ArrayBuffer[]=[];for(let start=0;start<bytes.length;start+=512*1024)parts.push(bytes.slice(start,start+512*1024).buffer);
    await ctx.runMutation(internal.accountCodeClaims.stageAvatar,{challengeHash:hash,leaseKey,contentType,chunks:parts});
    return Response.json({ok:true},{headers});
    }finally{await ctx.runMutation(internal.accountCodeClaims.releaseAvatar,{challengeHash:hash,leaseKey});}
  }catch{return new Response("Photo could not be prepared. Choose a JPG, PNG or WebP up to 5 MB.",{status:400,headers});}
}) });
http.route({ path: "/chat-attachment", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/chat-attachment", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  const url = new URL(req.url);
  const download = url.searchParams.get("download");
  const preview = url.searchParams.get("preview");
  if (download && preview) return new Response("Choose download or preview.", { status: 400, headers });
  if (!download && !preview && !chatAttachmentsReady()) return new Response("Attachments are temporarily unavailable.", { status: 503, headers });
  const admin = url.searchParams.get("admin") === "1";
  let id: any, marker: string | undefined, storageId: any;
  try {
    const scope = { token: adminHttpToken(req, admin && process.env.ADMIN_SESSION_ATTACHMENTS_V2 === "enabled"), admin, bookingId: (url.searchParams.get("bookingId") || undefined) as any, accountId: (url.searchParams.get("accountId") || undefined) as any };
    if (download || preview) {
      const attachmentId = (download || preview) as any;
      const file = await ctx.runMutation(internal.chatAttachments.download, { ...scope, id: attachmentId });
      if (preview && !isChatImageType(file.contentType ?? "")) return new Response("Inline previews support verified JPG, PNG and WebP images only.", { status: 415, headers });
      const stored = await ctx.storage.get(file.storageId);
      if (!stored || stored.size !== file.size) throw Error("File unavailable.");
      const bytes = new Uint8Array(await stored.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
      if (hash !== file.sha256) throw Error("File unavailable.");
      const current = await ctx.runMutation(internal.chatAttachments.download, { ...scope, id: attachmentId });
      if (current.storageId !== file.storageId || current.messageId !== file.messageId || current.sha256 !== file.sha256 || current.size !== file.size || current.name !== file.name || current.contentType !== file.contentType) throw Error("File unavailable.");
      return new Response(bytes, { headers: { ...headers, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Type": preview ? file.contentType ?? "application/octet-stream" : "application/octet-stream", "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${file.name}"` } });
    }
    // The browser's availability check is only a convenience. Authenticate the
    // exact upload scope and repeat the scanner self-test at the server edge so
    // a direct POST cannot skip the UI readiness gate.
    await ctx.runQuery(internal.chatAttachments.availabilityAccess, scope);
    if (!await chatAttachmentScannerHealthy()) return new Response("Attachments are temporarily unavailable.", { status: 503, headers });
    const nonce = crypto.randomUUID().replace(/-/g, "");
    marker = `application/vnd.dbcinema.chat-${nonce}`;
    const reservation = await ctx.runMutation(internal.chatAttachments.reserve, { ...scope, marker, requestKey: url.searchParams.get("key") ?? "" });
    if (reservation.status === "pending") return new Response("Upload is processing.", { status: 409, headers });
    if (reservation.status !== "published") id = reservation.id;
    const declared = Number(req.headers.get("content-length"));
    if (declared > CHAT_ATTACHMENT_LIMIT) throw Error("File too large.");
    const reader = req.body?.getReader();
    if (!reader) throw Error("Missing file.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > CHAT_ATTACHMENT_LIMIT) { await reader.cancel(); throw Error("File too large."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const contentType = req.headers.get("content-type") ?? "";
    const encodedName = req.headers.get("x-chat-filename") ?? "attachment";
    if (encodedName.length > 1080) throw Error("Invalid filename.");
    const name = decodeURIComponent(encodedName);
    if (!isChatAttachmentType(contentType) || !isChatAttachmentNameMatched(name, contentType)) throw Error("Unsupported file type or extension.");
    if (contentType === "text/plain" && size > CHAT_TEXT_LIMIT) throw Error("Text file too large.");
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(part => part.toString(16).padStart(2, "0")).join("");
    if (reservation.status === "published") {
      if (reservation.sha256 !== sha256 || reservation.size !== size || reservation.contentType !== contentType || reservation.name !== chatAttachmentName(name, contentType)) throw Error("Upload retry does not match the original file.");
      return Response.json({ ok: true }, { headers });
    }
    const verdict = await scanChatAttachment(bytes, sha256, nonce, { endpoint: process.env.CHAT_ATTACHMENT_SCANNER_URL ?? "", token: process.env.CHAT_ATTACHMENT_SCANNER_TOKEN ?? "" });
    if (verdict.contentType !== contentType) throw Error("File contents do not match the selected file type.");
    await ctx.runMutation(internal.chatAttachments.recordScan, { id, marker, size, sha256, contentType: verdict.contentType, engine: verdict.engine, signatureVersion: verdict.signatureVersion, signatureUpdatedAt: verdict.signatureUpdatedAt });
    storageId = await ctx.storage.store(new Blob([bytes], { type: marker }));
    const stored = await ctx.storage.get(storageId);
    if (!stored || stored.size !== size) throw Error("File unavailable.");
    const storedHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await stored.arrayBuffer()))).map(part => part.toString(16).padStart(2, "0")).join("");
    if (storedHash !== sha256) throw Error("File unavailable.");
    await ctx.runMutation(internal.chatAttachments.publish, { ...scope, id, marker, storageId, name });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (id && marker) try { await ctx.runMutation(internal.chatAttachments.fail, { id, marker, storageId }); } catch {}
    if (error instanceof ChatAttachmentRejectedError) return new Response("This file could not pass the security check, so it was not shared.", { status: 422, headers });
    if (error instanceof ChatAttachmentScannerUnavailableError) return new Response("File security checks are temporarily unavailable. Please retry.", { status: 503, headers });
    return new Response("Attachment unavailable.", { status: 403, headers });
  }
}) });
http.route({path:"/renter-drone-document",method:"OPTIONS",handler:httpAction(async(_ctx,req)=>{
  const cors=documentCors(req);return new Response(null,{status:cors?204:403,headers:cors??{}});
})});
http.route({path:"/renter-drone-document",method:"POST",handler:httpAction(async(ctx,req)=>{
  const cors=documentCors(req);if(!cors)return new Response("Forbidden",{status:403});
  const headers={...cors,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
  let storageId;
  try{
    const bookingId=new URL(req.url).searchParams.get("bookingId") as any;
    const token=req.headers.get("authorization")?.replace(/^Bearer /,"")||undefined;
    const checkoutSessionId=req.headers.get("x-checkout-session")||undefined;
    const access={bookingId,token,checkoutSessionId};
    await ctx.runQuery(internal.droneLicences.uploadAccess,access);
    const declared=Number(req.headers.get("content-length"));
    if(declared>DRONE_DOCUMENT_LIMIT)return new Response("Choose a document up to 10 MB.",{status:413,headers});
    const blob=await req.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
    const contentType=droneDocumentType(bytes,req.headers.get("content-type")??"");
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
    storageId=await ctx.storage.store(new Blob([bytes],{type:contentType}));
    const stored=await ctx.storage.get(storageId);
    if(!stored || stored.size!==bytes.length)throw Error("Uploaded document could not be saved. Please retry.");
    const storedHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await stored.arrayBuffer()))).map(b=>b.toString(16).padStart(2,"0")).join("");
    if(storedHash!==sha256)throw Error("Uploaded document could not be verified. Please retry.");
    const result=await ctx.runMutation(internal.droneLicences.saveUpload,{...access,storageId,sha256,contentType,size:bytes.length});
    storageId=undefined;
    return Response.json(result,{headers});
  }catch{
    if(storageId && await ctx.storage.get(storageId))await ctx.storage.delete(storageId);
    return new Response("Document could not be saved. Check your account and rental, then upload a PDF, JPG, PNG or WebP up to 10 MB.",{status:403,headers});
  }
})});
http.route({ path: "/admin-private-portrait", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-private-portrait", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  try {
    const token = adminHttpToken(req, process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled");
    const { accountId, documentId } = await req.json();
    const selected = () => ctx.runQuery(api.privateVerificationPortrait.selected, { token, accountId, refresh: Math.floor(Date.now() / 60000) });
    if ((await selected())?.documentId !== documentId) throw Error("Portrait unavailable");
    const document = await ctx.runMutation(internal.verificationArchive.downloadAccess, { token, documentId });
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) throw Error("Portrait unavailable");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== document.size || digest !== document.sha256 || (await selected())?.documentId !== documentId) throw Error("Portrait unavailable");
    return new Response(bytes, { headers: { ...headers, "Content-Type": document.contentType, "Content-Disposition": "inline; filename=private-portrait" } });
  } catch {
    return new Response("Portrait unavailable", { status: 403, headers });
  }
}) });
http.route({ path: "/admin-verification-document", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-verification-document", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = adminHttpToken(req, process.env.ADMIN_SESSION_VERIFICATION_V2 === "enabled");
    const { documentId } = await req.json();
    const document = await ctx.runMutation(internal.verificationArchive.downloadAccess, { token, documentId });
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) return new Response("Document unavailable", { status: 404, headers });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== document.size || digest !== document.sha256)
      return new Response("Document integrity check failed", { status: 409, headers });
    const extension = document.contentType === "application/pdf" ? "pdf" : document.contentType === "image/png" ? "png" : document.contentType === "image/webp" ? "webp" : "jpg";
    return new Response(bytes, { headers: { ...headers, "Content-Type": document.contentType, "Content-Disposition": `inline; filename="verification-document.${extension}"` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /unauthorized|administrator token/i.test(message) ? 403
      : /document not found/i.test(message) ? 404
      : /retention period ended/i.test(message) ? 410
      : /saved document is missing or invalid/i.test(message) ? 409
      : 503;
    return new Response(status === 409 ? "Document integrity check failed" : status === 404 ? "Document unavailable" : "Document access is temporarily unavailable", { status, headers });
  }
}) });

// Stripe webhook → server-side booking confirmation (see checkout.stripeWebhook for the
// 2-step activation). Transports the raw body + signature to the node action that verifies
// and confirms. Public URL: https://<deployment>.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature") ?? "";
    const body = await req.text();
    const ok: boolean = await ctx.runAction(internal.checkout.stripeWebhook, { body, sig });
    return new Response(ok ? "ok" : "ignored", { status: ok ? 200 : 400 });
  }),
});

http.route({
  path: "/didit-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const result: boolean | "processing_error" = await ctx.runAction(internal.didit.webhook, {
      body,
      signature: req.headers.get("x-signature-v2") ?? "",
      previousSignature: req.headers.get("x-signature-v2-previous") ?? undefined,
      rawSignature: req.headers.get("x-signature") ?? undefined,
      previousRawSignature: req.headers.get("x-signature-previous") ?? undefined,
      timestamp: req.headers.get("x-timestamp") ?? "",
    });
    return new Response(result === true ? "ok" : result === "processing_error" ? "temporarily unavailable" : "invalid", { status: result === true ? 200 : result === "processing_error" ? 500 : 400 });
  }),
});

// Telegram inbound — Approve/Decline inline-button callbacks for booking change requests.
// Set the bot webhook to https://<deployment>.convex.site/telegram with secret_token = TELEGRAM_WEBHOOK_SECRET.
http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const cb = update?.callback_query;
    if (cb?.data && typeof cb.data === "string" && cb.data.startsWith("chg:")) {
      const [, action, requestId] = cb.data.split(":");
      if (requestId && (action === "approve" || action === "decline")) {
        await ctx.runAction(internal.changes.resolveChange, {
          requestId: requestId as any,
          action,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id,
          messageId: cb.message?.message_id,
        });
      }
    }
    // admin REPLY to an escalation message → route into the renter's chat thread
    const msg = update?.message;
    if (msg?.reply_to_message?.message_id && typeof msg.text === "string" && msg.text.trim()) {
      await ctx.runMutation(internal.chat._adminReply, { tgMessageId: msg.reply_to_message.message_id, text: msg.text });
    }
    return new Response("ok");
  }),
});

export default http;
