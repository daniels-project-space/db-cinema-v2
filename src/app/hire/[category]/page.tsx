import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HIRE_CATEGORIES } from "@/lib/hireCategories";
import { discoveryListings } from "@/lib/discovery";
import { SITE_URL } from "@/lib/site";
import { SiteHeader } from "@/components/SiteHeader";

export const revalidate = 3600;
export const generateStaticParams = () => HIRE_CATEGORIES.map(c => ({ category: c.slug }));
type Props = { params: Promise<{ category: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params, c = HIRE_CATEGORIES.find(c => c.slug === category);
  if (!c) return { title: "Hire category not found", robots: { index: false } };
  return { title: `${c.name} London`, description: c.description, alternates: { canonical: `/hire/${c.slug}` }, openGraph: { title: `${c.name} London | DB Cinema Rentals`, description: c.description, url: `${SITE_URL}/hire/${c.slug}` } };
}
export default async function HireCategory({ params }: Props) {
  const { category } = await params, c = HIRE_CATEGORIES.find(c => c.slug === category);
  if (!c) notFound();
  const rows = (await discoveryListings()).filter(r => r.category === c.category);
  const schema = { "@context": "https://schema.org", "@type": "CollectionPage", name: `${c.name} London`, url: `${SITE_URL}/hire/${c.slug}`, description: c.description, mainEntity: { "@type": "ItemList", itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.title, url: `${SITE_URL}/gear/${r.slug}` })) } };
  return <><SiteHeader /><main className="mx-auto max-w-6xl px-6 py-12">
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-white/50"><Link href="/">Home</Link> / <Link href="/gear">Gear</Link> / {c.name}</nav>
    <p className="hud-label text-accent-400">London equipment rental</p>
    <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{c.name} London</h1>
    <p className="mt-5 max-w-3xl text-lg leading-relaxed text-white/65">{c.description}</p>
    <div className="mt-7 flex flex-wrap gap-3"><Link href={`/gear?cat=${encodeURIComponent(c.category)}`} className="rounded-full bg-accent-500 px-5 py-3 font-semibold text-black">Choose dates &amp; compare</Link><Link href="/contact" className="rounded-full border border-white/15 px-5 py-3">Ask about your shoot</Link></div>
    <section className="mt-12" aria-labelledby="hire-products"><h2 id="hire-products" className="font-display text-2xl">Explore {c.name.toLowerCase()}</h2><p className="mt-2 text-sm text-white/50">Open a listing for its packing list, rates and availability for your dates.</p><ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(r => <li key={r.slug}><Link href={`/gear/${r.slug}`} className="block h-full rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition-colors hover:border-accent-400/50"><span className="font-medium text-white/90">{r.title}</span><span className="mt-3 block text-sm text-accent-400">View kit &amp; dates →</span></Link></li>)}</ul></section>
    <section className="mt-12 rounded-2xl border border-white/10 p-6"><h2 className="font-display text-2xl">Before you book</h2><ul className="mt-4 space-y-3 text-white/65">{c.tips.map(t => <li key={t}>✓ {t}</li>)}</ul><div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href={`/guides/${c.guide}`}>Read the hire guide →</Link><Link href="/how-it-works">Collection &amp; delivery →</Link><Link href="/faq">Rental questions →</Link></div></section>
    <nav aria-label="Other hire departments" className="mt-10 flex flex-wrap gap-3">{HIRE_CATEGORIES.filter(x => x.slug !== c.slug).map(x => <Link key={x.slug} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60" href={`/hire/${x.slug}`}>{x.name}</Link>)}</nav>
  </main><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /></>;
}
