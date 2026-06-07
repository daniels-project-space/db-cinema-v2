import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

export async function Footer() {
  let cfg: any = {};
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    cfg = await c.query(api.settings.get, {});
  } catch {}

  return (
    <footer className="section-glass mt-20 border-t border-white/5 px-6 py-12">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-display text-lg font-bold">
            <span className="text-white/90">DB</span>{" "}
            <span className="gradient-text">CINEMA</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-white/35">
            Professional cinema gear for hire in London. Cameras, lenses, lighting,
            audio and drones — daily rates, delivered.
          </p>
          {/* NAP — consistent name/address/phone for local SEO */}
          <address className="mt-4 not-italic text-xs leading-relaxed text-white/30">
            <div className="text-white/45">Db Cinema Rentals</div>
            {cfg.businessAddress ? <div>{cfg.businessAddress}</div> : <div>London, United Kingdom</div>}
            {cfg.businessPhone && (
              <div>
                <a href={`tel:${String(cfg.businessPhone).replace(/\s/g, "")}`} className="hover:text-white">
                  {cfg.businessPhone}
                </a>
              </div>
            )}
            <div>Open {cfg.openingHours ?? "10:00–12:00 & 19:00–21:00, daily"}</div>
          </address>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">Rent</div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/gear" className="hover:text-white">All gear</Link></li>
            <li><Link href="/membership" className="hover:text-white">Membership</Link></li>
            <li><Link href="/#reviews" className="hover:text-white">Reviews</Link></li>
            <li><Link href="/cart" className="hover:text-white">Your kit</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">Learn</div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/guides" className="hover:text-white">Guides</Link></li>
            <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/how-it-works" className="hover:text-white">How it works</Link></li>
            <li><Link href="/about" className="hover:text-white">About us</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact us</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">Legal</div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/legal/rental-terms" className="hover:text-white">Rental terms</Link></li>
            <li><Link href="/legal/cancellation" className="hover:text-white">Cancellation</Link></li>
            <li><Link href="/legal/terms" className="hover:text-white">Terms &amp; conditions</Link></li>
            <li><Link href="/legal/privacy" className="hover:text-white">Privacy policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/5 pt-6 text-xs text-white/25">
        © 2026 Db Cinema Rentals. Cinema camera &amp; film equipment hire, London.
      </div>
    </footer>
  );
}
