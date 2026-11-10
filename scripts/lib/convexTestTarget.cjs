function resolveConvexTestTarget(env = process.env) {
  const target = env.DBC_CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (!target) {
    throw new Error(
      "Set DBC_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL to the Convex deployment being tested; refusing to use a baked-in deployment URL.",
    );
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("The Convex test target must be an absolute URL.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!local && parsed.protocol !== "https:") {
    throw new Error("The Convex test target must use HTTPS outside localhost.");
  }
  return target.replace(/\/+$/, "");
}

module.exports = { resolveConvexTestTarget };
