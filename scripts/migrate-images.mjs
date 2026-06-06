// One-off: migrate hotlinked imgix images into R2, set listing.r2Images.
// Run from repo root on the VPS with R2_* env injected. Idempotent: only
// processes listings that don't yet have r2Images.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const CONVEX = "https://veracious-wombat-196.convex.cloud";
const PUBLIC_BASE = "https://pub-761e4d18b3b84542809dddc11936a8df.r2.dev";
const BUCKET = "db-cinema-v2";
const MAX_IMAGES = 4;
const CONCURRENCY = 8;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function convexQuery(path, args = {}) {
  const r = await fetch(`${CONVEX}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const j = await r.json();
  if (j.status !== "success") throw new Error(j.errorMessage);
  return j.value;
}
async function convexMutation(path, args = {}) {
  const r = await fetch(`${CONVEX}/api/mutation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const j = await r.json();
  if (j.status !== "success") throw new Error(j.errorMessage);
  return j.value;
}

async function migrateOne(l) {
  const urls = l.sourceImages.slice(0, MAX_IMAGES);
  const r2 = [];
  let idx = 0;
  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      const key = `listings/${l.hyggloProductId || l.slug}/${idx}.jpg`;
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buf,
          ContentType: "image/jpeg",
        }),
      );
      r2.push(`${PUBLIC_BASE}/${key}`);
      idx++;
    } catch (e) {
      console.error("img fail", l.slug, e.message);
    }
  }
  return r2.length ? { slug: l.slug, r2Images: r2 } : null;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const cur = items[i++];
        const res = await fn(cur);
        if (res) out.push(res);
      }
    }),
  );
  return out;
}

const todo = await convexQuery("catalog:listForMigration");
console.log(`listings to migrate: ${todo.length}`);
const results = await pool(todo, CONCURRENCY, migrateOne);
console.log(`uploaded images for ${results.length} listings; writing back…`);
// batch the mutation in chunks of 100
for (let i = 0; i < results.length; i += 100) {
  const chunk = results.slice(i, i + 100);
  const res = await convexMutation("catalog:applyR2Images", { items: chunk });
  console.log(`  applied ${res.updated} (chunk ${i / 100 + 1})`);
}
console.log("done");
