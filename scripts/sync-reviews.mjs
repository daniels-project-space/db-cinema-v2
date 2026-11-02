import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeHyggloReview,
  parseAuthorizedHyggloExport,
  verifyHyggloProfilePhoto,
} from "./lib/hyggloReviewImport.mjs";

const APPLY = process.argv.slice(2);
if (APPLY.some((arg) => arg !== "--apply") || APPLY.length > 1) {
  throw new Error("Usage: node scripts/sync-reviews.mjs [--apply]");
}
const apply = APPLY.includes("--apply");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportPath = process.env.HYGGLO_REVIEW_EXPORT_PATH;
if (!exportPath) throw new Error("Set HYGGLO_REVIEW_EXPORT_PATH to an authorized JSON export outside the repository.");
const resolvedExportPath = path.resolve(exportPath);
const exportRelativePath = path.relative(repoRoot, resolvedExportPath);
if (!exportRelativePath.startsWith("..") || path.isAbsolute(exportRelativePath)) {
  throw new Error("The authorized review export must be stored outside the repository.");
}

const exportData = JSON.parse(await readFile(resolvedExportPath, "utf8"));
const sourceReviews = parseAuthorizedHyggloExport(exportData);
const unique = new Map();
let rejected = 0;
let invalidPhotos = 0;
let duplicateSourceRows = 0;

for (const sourceReview of sourceReviews) {
  const normalized = normalizeHyggloReview(sourceReview);
  if (!normalized) {
    rejected++;
    continue;
  }
  const prior = unique.get(normalized.hyggloReviewId);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(normalized)) {
      throw new Error("Conflicting rows share a source review ID; no changes were written.");
    }
    duplicateSourceRows++;
    continue;
  }
  unique.set(normalized.hyggloReviewId, normalized);
}

const candidates = [...unique.values()];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < candidates.length) {
    const index = cursor++;
    if (!(await verifyHyggloProfilePhoto(candidates[index].authorImage))) {
      candidates[index] = null;
      invalidPhotos++;
    } else {
      candidates[index] = { ...candidates[index], sourcePhotoVerified: true };
    }
  }
}));
const items = candidates.filter(Boolean);
console.log(`Source rows: ${sourceReviews.length}; eligible 5-star rows: ${items.length}; excluded rows: ${rejected + invalidPhotos}; duplicate source rows: ${duplicateSourceRows}.`);
if (items.length === 0) throw new Error("No eligible rows with verified source ratings and profile photos; no changes were written.");
if (!apply) {
  console.log("Dry run only. Review the authorized export, then rerun with --apply to upsert verified records.");
  process.exit(0);
}

const adminToken = process.env.DBC_ADMIN_TOKEN;
if (!adminToken) throw new Error("DBC_ADMIN_TOKEN is required with --apply.");
const convexUrlValue = process.env.CONVEX_REVIEW_IMPORT_URL;
if (!convexUrlValue) throw new Error("CONVEX_REVIEW_IMPORT_URL is required with --apply.");
const convexUrl = new URL(convexUrlValue);
if (
  convexUrl.protocol !== "https:" ||
  !/^[a-z0-9-]+\.convex\.cloud$/i.test(convexUrl.hostname) ||
  convexUrl.pathname !== "/" ||
  convexUrl.search ||
  convexUrl.hash ||
  convexUrl.username ||
  convexUrl.password
) {
  throw new Error("CONVEX_REVIEW_IMPORT_URL must be a deployment's HTTPS .convex.cloud origin.");
}

async function postMutation(pathname, args) {
  const response = await fetch(`${convexUrl.origin}/api/mutation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: pathname, args, format: "json" }),
  });
  if (!response.ok) throw new Error(`Review upsert failed with HTTP ${response.status}.`);
  const result = await response.json();
  if (result.status !== "success") throw new Error("Review upsert mutation failed; existing rows were not cleared.");
  return result.value;
}

for (let index = 0; index < items.length; index += 100) {
  const chunk = items.slice(index, index + 100);
  const result = await postMutation("reviews:insertChunk", { token: adminToken, items: chunk });
  console.log(`Upserted ${Math.min(index + chunk.length, items.length)}/${items.length} eligible records (${result.upserted} created or updated).`);
}
