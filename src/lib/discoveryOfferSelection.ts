export function discoveryOfferSlugs(rows: ReadonlyArray<{ slug: string }>): string[] {
  const slugs = new Set<string>();
  for (const row of rows) {
    slugs.add(row.slug);
    if (slugs.size === 24) break;
  }
  return [...slugs];
}
