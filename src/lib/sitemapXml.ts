// Next's metadata sitemap serializer interpolates URL strings verbatim.
// Escape XML entities without changing query parameters in the actual URL.
export function sitemapXmlUrl(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
