import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "About — Db Cinema Rentals" };

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-14">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">About us</div>
        <h1 className="font-display text-4xl font-bold text-white/90">
          Cinema gear, <span className="gradient-text">ready to roll</span>
        </h1>
        <div className="mt-8 flex flex-col gap-5 text-white/55 leading-relaxed">
          <p>
            Db Cinema Rentals is a London-based hire house for professional film
            and photography equipment — cinema cameras, lenses, lighting, audio,
            stabilisers and more. We started out renting our own kit between
            shoots and grew into one of the most-reviewed gear hosts in the city.
          </p>
          <p>
            Every item is owned, maintained and tested by us. Whether you&apos;re
            shooting a short film, a music video, a wedding or a brand campaign,
            you get pro gear at fair daily rates — and the longer you rent, the
            more you save.
          </p>
          <p>
            We offer pickup from central London or local delivery, with a simple,
            secure booking process and a refundable deposit. Thousands of happy
            renters later, our mission is the same: keep great gear working on
            great projects.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          {[
            ["4.86★", "average rating"],
            ["875+", "verified reviews"],
            ["200+", "items for hire"],
          ].map(([n, l]) => (
            <div key={l} className="rounded-2xl glass gradient-border p-5">
              <div className="font-display text-2xl font-bold text-accent-400">{n}</div>
              <div className="mt-1 text-xs text-white/40">{l}</div>
            </div>
          ))}
        </div>
        <Link href="/gear" className="mt-10 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white hover:bg-accent-600">
          Browse the catalogue
        </Link>
      </main>
    </>
  );
}
