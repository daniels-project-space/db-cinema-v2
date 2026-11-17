import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HIRE_CATEGORIES } from "@/lib/hireCategories";
import { discoveryListings, discoveryOffers, discoveryCameraPage, publicCatalogRevision } from "@/lib/discovery";
import { CatalogRevisionGuard } from "@/components/CatalogRevisionGuard";
import { HireOfferGrid } from "@/components/HireOfferGrid";
import { discoveryOfferSlugs } from "@/lib/discoveryOfferSelection";
import { SITE_URL } from "@/lib/site";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";
export const generateStaticParams = () => HIRE_CATEGORIES.map(c => ({ category: c.slug }));
type Props = { params: Promise<{ category: string }>; searchParams: Promise<{ after?: string | string[] }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category } = await params, c = HIRE_CATEGORIES.find(c => c.slug === category);
  if (!c) return { title: "Hire category not found", robots: { index: false } };
  const { after } = await searchParams;
  if (c.category === "Cameras" && after !== undefined && (typeof after !== "string" || !/^[a-z0-9-]{1,200}$/.test(after))) return { title: "Hire category not found", robots: { index: false } };
  const cameraPage = c.category === "Cameras" && typeof after === "string" ? await discoveryCameraPage(after) : null;
  const emptyEnd = cameraPage && cameraPage.page.length === 0 && !cameraPage.nextAfter;
  const canonical = `/hire/${c.slug}${c.category === "Cameras" && typeof after === "string" ? `?after=${encodeURIComponent(after)}` : ""}`;
  const title = c.category === "Cameras" ? "Camera Hire & Rental London" : c.category === "Lenses" ? "Lens Hire & Rental London" : `${c.name} London`;
  return { title, description: c.description, ...(emptyEnd ? { robots: { index: false, follow: true } } : {}), alternates: { canonical }, openGraph: { title: `${title} | DB Cinema Rentals`, description: c.description, url: `${SITE_URL}${canonical}` } };
}
export default async function HireCategory({ params, searchParams }: Props) {
  const { category } = await params, c = HIRE_CATEGORIES.find(c => c.slug === category);
  if (!c) notFound();
  const { after } = await searchParams;
  if (c.category === "Cameras" && after !== undefined && (typeof after !== "string" || !/^[a-z0-9-]{1,200}$/.test(after))) notFound();
  const revision = await publicCatalogRevision();
  const cameraPage = c.category === "Cameras" ? await discoveryCameraPage(typeof after === "string" ? after : undefined) : null;
  const rows = cameraPage?.page ?? (await discoveryListings()).filter(r => r.category === c.category);
  const cameraOffers = cameraPage ? (await discoveryOffers(discoveryOfferSlugs(rows))).filter(offer => offer.category === "Cameras") : [];
  const lensOffers = c.category === "Lenses" ? (await discoveryOffers(discoveryOfferSlugs(rows.slice(0, 6)))).filter(offer => offer.category === "Lenses") : [];
  const schema = { "@context": "https://schema.org", "@type": "CollectionPage", name: `${c.name} London`, url: `${SITE_URL}/hire/${c.slug}${cameraPage && typeof after === "string" ? `?after=${encodeURIComponent(after)}` : ""}`, description: c.description, mainEntity: { "@type": "ItemList", itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.title, url: `${SITE_URL}/gear/${r.slug}` })) } };
  return <><SiteHeader /><CatalogRevisionGuard revision={revision}><main className="mx-auto max-w-6xl px-6 py-12">
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-white/50"><Link href="/">Home</Link> / <Link href="/gear">Gear</Link> / {c.name}</nav>
    <p className="hud-label text-accent-400">London equipment rental</p>
    <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{c.name} London</h1>
    <p className="mt-5 max-w-3xl text-lg leading-relaxed text-white/65">{c.description}</p>
    <div className="mt-7 flex flex-wrap gap-3"><Link href={`/gear?cat=${encodeURIComponent(c.category)}`} className="rounded-full bg-accent-500 px-5 py-3 font-semibold text-black">Choose dates &amp; compare</Link><Link href="/contact" className="rounded-full border border-white/15 px-5 py-3">Ask about your shoot</Link></div>
    {c.category === "Cameras" && <section className="mt-12"><h2 className="font-display text-2xl">Camera hire options</h2><p className="mt-2 text-sm text-white/50">A selection from our catalogue. Daily rates shown below; select dates to check current availability and the full rental price.</p><HireOfferGrid offers={cameraOffers.slice(0, 6)} /><div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href="/gear?cat=Cameras">Browse all cameras →</Link><Link href="/hire/sony-fx3-hire-london">Compare Sony FX3 hire options →</Link></div></section>}
    {c.category === "Lenses" && <section className="mt-12" aria-labelledby="lens-options"><h2 id="lens-options" className="font-display text-2xl">Compare lens rental options</h2><p className="mt-2 text-sm text-white/50">A selection from our catalogue. Day rates and up to four listed kit items are shown below; open each listing for the full kit, rental price and date-specific availability.</p><HireOfferGrid offers={lensOffers} showContents /><div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href="/gear?cat=Lenses">Browse all lenses →</Link><Link href="/hire/camera-hire-london">Compare camera hire →</Link></div></section>}
    {c.category === "Cameras" && !after && <section className="mt-12 rounded-2xl border border-white/10 p-6" aria-labelledby="camera-rental-guide">
      <h2 id="camera-rental-guide" className="font-display text-2xl">Choosing a camera rental in London</h2>
      <div className="mt-4 grid gap-5 text-sm leading-relaxed text-white/65 sm:grid-cols-2">
        <div><h3 className="font-semibold text-white/85">Body or complete kit?</h3><p className="mt-2">Compare each listing’s packing list before booking: a body kit and a camera with a lens, media or support can contain different parts. Add any missing equipment to your basket and check the complete setup for your dates.</p></div>
        <div><h3 className="font-semibold text-white/85">Plan your shoot</h3><p className="mt-2">Match the recording format, lens mount and power needs to the job. For interviews, check audio connections; for moving shots, check the total camera and lens weight against your support.</p></div>
        <div><h3 className="font-semibold text-white/85">Dates and rental prices</h3><p className="mt-2">The displayed day rate helps compare listings. Choose your pickup and return times to see the rental quote and date-specific availability; minimum hire periods are shown where they apply.</p></div>
        <div><h3 className="font-semibold text-white/85">Collection or delivery</h3><p className="mt-2">Choose central London collection or request local delivery during booking. Your quote shows the available arrangements and charges for your selected kit and dates.</p></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href="/hire/sony-fx3-hire-london">Compare Sony FX3 kits →</Link><Link href="/hire/lens-hire-london">Explore lenses →</Link><Link href="/guides/camera-hire-london-guide">Plan your camera hire →</Link></div>
    </section>}
    {c.category === "Lenses" && <section className="mt-12 rounded-2xl border border-white/10 p-6" aria-labelledby="lens-rental-guide">
      <h2 id="lens-rental-guide" className="font-display text-2xl">Choosing a lens for your shoot</h2>
      <div className="mt-4 grid gap-5 text-sm leading-relaxed text-white/65 sm:grid-cols-2">
        <div><h3 className="font-semibold text-white/85">Focal length and coverage</h3><p className="mt-2">Choose the field of view for your location and subject. Check that the lens covers your camera sensor; the same focal length can frame differently on different sensor sizes.</p></div>
        <div><h3 className="font-semibold text-white/85">Mounts and adapters</h3><p className="mt-2">Match the lens and camera mounts before booking. If an adapter is needed, check that it supports the functions you require and whether it is included or rented separately.</p></div>
        <div><h3 className="font-semibold text-white/85">Prime, zoom or anamorphic</h3><p className="mt-2">Compare a fixed focal length with the flexibility of a zoom. For anamorphic lenses, check sensor coverage, squeeze ratio and your monitoring and post-production workflow.</p></div>
        <div><h3 className="font-semibold text-white/85">Kit and rental dates</h3><p className="mt-2">Check the exact listing for caps, filters, cases and other supplied items. Choose your dates to see the rental total and whether the equipment is available.</p></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href="/guides/choosing-camera-lenses">Read the lens guide →</Link><Link href="/hire/camera-hire-london">Find a camera →</Link><Link href="/how-it-works">Collection and delivery →</Link></div>
    </section>}
    <section className="mt-12" aria-labelledby="hire-products"><h2 id="hire-products" className="font-display text-2xl">Explore {c.name.toLowerCase()}</h2><p className="mt-2 text-sm text-white/50">Open a listing for its packing list, rates and availability for your dates.</p><ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(r => <li key={r.slug}><Link href={`/gear/${r.slug}`} className="block h-full rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition-colors hover:border-accent-400/50"><span className="font-medium text-white/90">{r.title}</span><span className="mt-3 block text-sm text-accent-400">View kit &amp; dates →</span></Link></li>)}</ul>{cameraPage?.nextAfter && <Link className="mt-6 inline-block text-accent-400" href={`/hire/camera-hire-london?after=${encodeURIComponent(cameraPage.nextAfter)}`}>Next camera listings →</Link>}{cameraPage && !cameraPage.page.length && !cameraPage.nextAfter && <p className="mt-6 text-white/65">There are no more cameras on this page. <Link className="text-accent-400" href="/hire/camera-hire-london">See all camera listings →</Link></p>}</section>
    <section className="mt-12 rounded-2xl border border-white/10 p-6"><h2 className="font-display text-2xl">Before you book</h2><ul className="mt-4 space-y-3 text-white/65">{c.tips.map(t => <li key={t}>✓ {t}</li>)}</ul><div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href={`/guides/${c.guide}`}>Read the hire guide →</Link><Link href="/how-it-works">Collection &amp; delivery →</Link><Link href="/faq">Rental questions →</Link></div></section>
    <nav aria-label="Other hire departments" className="mt-10 flex flex-wrap gap-3">{HIRE_CATEGORIES.filter(x => x.slug !== c.slug).map(x => <Link key={x.slug} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60" href={`/hire/${x.slug}`}>{x.name}</Link>)}</nav>
  </main></CatalogRevisionGuard><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /></>;
}
