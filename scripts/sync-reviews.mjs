// Aggregate ALL db cinema reviews from Hygglo per-product listing details,
// dedupe by review id, and load into the storefront `reviews` table.
const RMV2 = "https://hearty-oyster-600.convex.cloud";
const STORE = "https://veracious-wombat-196.convex.cloud";
const HYGGLO = "https://api.hygglo.com/api";
const CONCURRENCY = 10;

async function post(base, kind, path, args) {
  const r = await fetch(`${base}/api/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const j = await r.json();
  if (j.status !== "success") throw new Error(`${path}: ${j.errorMessage}`);
  return j.value;
}
const hygglo = async (url) => {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`hygglo ${r.status}`);
  return r.json();
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const products = await post(RMV2, "query", "hygglo_products:list", {
  accountSlug: "dbcinema",
});
// one listing id per product (product.reviews aggregates across its listings)
const listingIds = [];
for (const p of products) {
  const lid = (p.listings ?? [])[0]?.id;
  if (lid) listingIds.push(lid);
}
console.log(`products: ${products.length}, listing ids to scan: ${listingIds.length}`);

const byId = new Map();
let scanned = 0;
await pool(listingIds, CONCURRENCY, async (lid) => {
  try {
    const d = await hygglo(`${HYGGLO}/v2/product-listings/${lid}?country=GB`);
    const reviews = d?.product?.reviews ?? [];
    for (const r of reviews) {
      if (!r?.id || byId.has(r.id)) continue;
      byId.set(r.id, {
        hyggloReviewId: r.id,
        author: (r.author?.shortName ?? "Renter").trim() || "Renter",
        authorImage: r.author?.profileImage?.fullSizeUrl ?? undefined,
        rating: typeof r.rating === "number" ? r.rating : 5,
        text: r.text ?? undefined,
        product: r.product?.name?.trim() ?? undefined,
        listingSlug: r.productListing?.slug ?? undefined,
        date: r.createdAt ? Date.parse(r.createdAt) : Date.now(),
      });
    }
  } catch (e) {
    /* skip unreachable listing */
  }
  scanned++;
  if (scanned % 50 === 0) console.log(`  scanned ${scanned}/${listingIds.length}, unique reviews ${byId.size}`);
});

const all = [...byId.values()];
const withText = all.filter((r) => r.text && r.text.trim().length > 8).length;
console.log(`unique reviews: ${all.length} (with text: ${withText})`);

await post(STORE, "mutation", "reviews:clearHygglo", {});
for (let i = 0; i < all.length; i += 200) {
  const chunk = all.slice(i, i + 200);
  await post(STORE, "mutation", "reviews:insertChunk", { items: chunk });
  console.log(`  inserted ${Math.min(i + 200, all.length)}/${all.length}`);
}
console.log("done");
