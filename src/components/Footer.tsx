import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { Marquee } from "@/components/Marquee";
import { GafferCall } from "@/components/GafferCall";
import { HOURS_LABEL } from "@/lib/site";

export async function Footer() {
  let cfg: any = {};
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    cfg = await c.query(api.settings.get, {});
  } catch {}

  return (
    <footer className="section-glass mt-24 border-t border-white/5">
      <Marquee
        items={["CAMERAS", "LENSES", "LIGHTING", "AUDIO", "DRONES", "STABILISERS", "MONITORS", "PACKAGES"]}
        speed={42}
        className="border-b border-white/5 py-4"
        itemClassName="font-mono text-[11px] tracking-[0.3em] text-white/25"
      />

      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-poster text-4xl uppercase leading-none sm:text-5xl">
            <span className="text-white">DB</span> <span className="gradient-text sheen">Cinema</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            <span className="hud-label !text-white/45">Booking online now</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/35">
            Professional cinema gear for hire in London. Cameras, lenses, lighting,
            audio and drones — daily rates, delivered.
          </p>
          {/* NAP — consistent name/address/phone for local SEO */}
          <address className="mt-4 not-italic font-mono text-[11px] leading-relaxed text-white/30">
            <div className="text-white/45">Db Cinema Rentals</div>
            {cfg.businessAddress ? <div>{cfg.businessAddress}</div> : <div>London, United Kingdom</div>}
            {cfg.businessPhone && (
              <div>
                <a href={`tel:${String(cfg.businessPhone).replace(/\s/g, "")}`} className="transition-colors hover:text-white">
                  {cfg.businessPhone}
                </a>
              </div>
            )}
            <div>
              <a href="mailto:dbcinemaproductions@gmail.com" className="transition-colors hover:text-white">
                dbcinemaproductions@gmail.com
              </a>
            </div>
            <div>Open {cfg.openingHours ?? HOURS_LABEL}</div>
          </address>
          <div className="mt-5">
            <GafferCall label="Talk to Gaffer" />
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">Live voice assistant · bookings &amp; gear help</p>
          </div>
        </div>

        <FooterCol
          title="Rent"
          links={[
            ["/gear", "All gear"],
            ["/membership", "Membership"],
            ["/#reviews", "Reviews"],
            ["/cart", "Your kit"],
          ]}
        />
        <FooterCol
          title="Learn"
          links={[
            ["/guides", "Guides"],
            ["/faq", "FAQ"],
            ["/how-it-works", "How it works"],
            ["/about", "About us"],
            ["/contact", "Contact us"],
          ]}
        />
        <FooterCol
          title="Legal"
          links={[
            ["/legal/rental-terms", "Rental terms"],
            ["/legal/cancellation", "Cancellation"],
            ["/legal/terms", "Terms & conditions"],
            ["/legal/privacy", "Privacy policy"],
          ]}
        />
      </div>

      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 border-t border-white/5 px-6 py-6">
        <span className="font-mono text-[11px] text-white/25">
          © 2026 Db Cinema Rentals · cinema camera &amp; film equipment hire, London
        </span>
        <span className="flex items-center gap-4 font-mono text-[11px] text-white/20">
          <span className="hidden sm:inline">51.5072°N 0.1276°W</span>
          <Link href="/admin" className="transition-colors hover:text-white/50">
            Owner login
          </Link>
        </span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="hud-label mb-4 !text-accent-400/90">{title}</div>
      <ul className="flex flex-col gap-2.5 text-sm text-white/50">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="arrow-link transition-colors hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
