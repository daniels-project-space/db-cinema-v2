const assert = require("node:assert/strict");
const { resolveConvexTestTarget } = require("./lib/convexTestTarget.cjs");

assert.equal(
  resolveConvexTestTarget({ DBC_CONVEX_URL: "https://selected.convex.cloud/", NEXT_PUBLIC_CONVEX_URL: "https://other.convex.cloud" }),
  "https://selected.convex.cloud",
  "The test-specific target takes precedence and trailing slashes are removed",
);
assert.equal(
  resolveConvexTestTarget({ NEXT_PUBLIC_CONVEX_URL: "https://preview.convex.cloud" }),
  "https://preview.convex.cloud",
  "The explicitly configured public application target is a valid fallback",
);
assert.throws(
  () => resolveConvexTestTarget({}),
  /Set DBC_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL/,
  "An absent target fails before any request can reach a deployment",
);
assert.throws(
  () => resolveConvexTestTarget({ DBC_CONVEX_URL: "not-a-url" }),
  /absolute URL/,
);
assert.throws(
  () => resolveConvexTestTarget({ DBC_CONVEX_URL: "http://remote.convex.cloud" }),
  /HTTPS outside localhost/,
);
assert.equal(
  resolveConvexTestTarget({ DBC_CONVEX_URL: "http://127.0.0.1:3210/" }),
  "http://127.0.0.1:3210",
  "Local Convex test deployments can use localhost HTTP",
);

console.log("PASS Convex test target selection and fail-fast validation.");
