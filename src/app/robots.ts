import type { MetadataRoute } from "next";

// Pre-launch / test mode: keep the storefront out of search engines so the
// public can't stumble in. Remove this block (return allow) at go-live.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
