import Link from "next/link";

export function Footer() {
  return (
    <footer className="section-glass mt-20 border-t border-white/5 px-6 py-12">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-display text-lg font-bold">
            <span className="text-white/90">DB</span>{" "}
            <span className="gradient-text">CINEMA</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-white/35">
            Professional cinema gear for hire. Daily, weekly and monthly rates,
            delivered across London.
          </p>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">
            Rent
          </div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/gear" className="hover:text-white">All gear</Link></li>
            <li><Link href="/#reviews" className="hover:text-white">Reviews</Link></li>
            <li><Link href="/cart" className="hover:text-white">Your kit</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">
            Company
          </div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/about" className="hover:text-white">About us</Link></li>
            <li><Link href="/how-it-works" className="hover:text-white">How it works</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact us</Link></li>
            <li><Link href="/legal/rental-terms" className="hover:text-white">Rental terms</Link></li>
            <li><Link href="/legal/cancellation" className="hover:text-white">Cancellation</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">
            Legal
          </div>
          <ul className="flex flex-col gap-2 text-sm text-white/50">
            <li><Link href="/legal/terms" className="hover:text-white">Terms &amp; conditions</Link></li>
            <li><Link href="/legal/privacy" className="hover:text-white">Privacy policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/5 pt-6 text-xs text-white/25">
        © {2026} Db Cinema Rentals. All rights reserved.
      </div>
    </footer>
  );
}
