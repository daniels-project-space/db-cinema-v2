import Link from "next/link";
import type { DiscoveryOffer } from "@/lib/discovery";
import { formatRate } from "@/lib/pricing";
import { HIRE_CATEGORIES } from "@/lib/hireCategories";
import styles from "./CameraHirePage.module.css";

type Props = {
  description: string;
  tips: readonly string[];
  guide: string;
  rows: { slug: string; title: string }[];
  offers: DiscoveryOffer[];
  nextAfter?: string | null;
};

function Aperture() {
  return <svg className={styles.aperture} viewBox="0 0 200 200" fill="none" aria-hidden="true">
    <circle cx="100" cy="100" r="92" /><circle cx="100" cy="100" r="72" /><circle cx="100" cy="100" r="26" />
    <path d="M100 28 126 78 172 81M172 81 137 125 150 153M150 153 95 143 68 172M68 172 63 118 28 100M28 100 77 75 81 28M81 28 113 68 126 78" />
    <path d="M100 74v52M74 100h52" className={styles.crosshair} />
  </svg>;
}

export function CameraHirePage({ description, tips, guide, rows, offers, nextAfter }: Props) {
  return <main className={styles.page}>
    <div className={styles.shell}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/gear">Gear</Link><span>/</span><span>Camera hire</span></nav>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span /> LONDON EQUIPMENT RENTAL</div>
          <h1>Camera hire <em>London.</em></h1>
          <p>{description}</p>
          <div className={styles.actions}><Link className={styles.primary} href="/gear?cat=Cameras">Explore cameras <span aria-hidden="true">↗</span></Link><Link className={styles.secondary} href="/contact">Contact us <span aria-hidden="true">↗</span></Link></div>
          <div className={styles.heroFooter}><span>MADE FOR YOUR NEXT SHOT</span><span>01 / CAMERAS</span></div>
        </div>
        <div className={styles.art} aria-hidden="true"><div className={styles.artGrid} /><div className={styles.orbit}><Aperture /></div><span className={styles.artTop}>THE CAMERA DEPARTMENT <i>✳</i></span><span className={styles.artBottom}>LONDON <b>●</b> READY TO CREATE</span></div>
      </header>
      <section className={styles.offers} aria-labelledby="camera-options">
        <div className={styles.sectionHeading}><div><span className={styles.kicker}>THE CAMERA DEPARTMENT / 01</span><h2 id="camera-options">Find your frame.</h2><p>Cinema cameras and mirrorless kits for your next production.</p></div><Link href="/gear?cat=Cameras">All cameras <span aria-hidden="true">↗</span></Link></div>
        {offers.length ? <ul className={styles.offerGrid}>{offers.map((offer, index) => <li key={offer.slug}><Link href={`/gear/${offer.slug}`} className={styles.offerCard}>
          <div className={styles.cardTop}><span>CAMERA KIT / {String(index + 1).padStart(2, "0")}</span><span className={styles.cardArrow} aria-hidden="true">↗</span></div>
          <div className={styles.cardGlyph} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="5" y="13" width="38" height="25" rx="5"/><path d="M13 13l3-4h10l3 4"/><circle cx="24" cy="25.5" r="8"/><circle cx="24" cy="25.5" r="4"/><path d="M36 18h2"/></svg></div>
          <h3>{offer.title}</h3><div className={styles.cardBottom}><span>{offer.daily !== null ? <>From <strong>£{formatRate(offer.daily)}</strong> / day{offer.minimumRentalDays > 1 ? ` · ${offer.minimumRentalDays}-day minimum` : ""}</> : "Explore this kit"}</span><span>View kit ↗</span></div>
        </Link></li>)}</ul> : <p className={styles.empty}>No matching kits are shown here right now. <Link href="/gear?cat=Cameras">Browse cameras</Link> or <Link href="/contact">contact us</Link> for alternatives.</p>}
        <div className={styles.extraLinks}><Link href="/hire/sony-fx3-hire-london">Explore Sony FX3 hire <span aria-hidden="true">↗</span></Link><Link href="/gear?cat=Cameras">Browse the full collection <span aria-hidden="true">↗</span></Link></div>
      </section>
      <section className={styles.guide} aria-labelledby="before-you-book"><div><span className={styles.kicker}>A LITTLE PREPARATION GOES A LONG WAY</span><h2 id="before-you-book">Ready for the<br/><em>next take?</em></h2><Link href={`/guides/${guide}`}>Read the camera hire guide ↗</Link></div><ol>{tips.map((tip, index) => <li key={tip}><span>{String(index + 1).padStart(2, "0")}</span><p>{tip}</p><span aria-hidden="true">✳</span></li>)}</ol></section>
      <details className={styles.directory}><summary><span><small>THE FULL COLLECTION</small><strong>Explore camera listings</strong></span><span aria-hidden="true">+</span></summary><ul>{rows.map(row => <li key={row.slug}><Link href={`/gear/${row.slug}`}>{row.title} <span aria-hidden="true">↗</span></Link></li>)}</ul>{nextAfter && <Link className={styles.nextPage} href={`/hire/camera-hire-london?after=${encodeURIComponent(nextAfter)}`}>Next camera listings →</Link>}</details>
      <nav aria-label="More hire information" className={styles.more}><Link href="/how-it-works">Collection &amp; delivery ↗</Link><Link href="/faq">Rental questions ↗</Link></nav>
      <nav aria-label="Other hire departments" className={styles.departments}>{HIRE_CATEGORIES.filter(category => category.category !== "Cameras").map(category => <Link key={category.slug} href={`/hire/${category.slug}`}>{category.name} ↗</Link>)}</nav>
    </div>
  </main>;
}
