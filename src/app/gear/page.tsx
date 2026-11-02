import Link from "next/link";
import {HIRE_CATEGORIES} from "@/lib/hireCategories";
import {discoveryListings,publicCatalogRevision} from "@/lib/discovery";
import {CatalogRevisionGuard} from "@/components/CatalogRevisionGuard";
import GearCatalogueClient from "./GearCatalogueClient";
export const dynamic="force-dynamic";
export default async function GearPage(){
 const revision=await publicCatalogRevision();
 const rows=await discoveryListings();
 return <><GearCatalogueClient/><CatalogRevisionGuard revision={revision}><section className="mx-auto max-w-7xl border-t border-white/10 px-6 py-10" aria-label="Equipment hire directory">
    <h2 className="font-display text-2xl">Find your equipment</h2>
    <nav aria-label="Hire departments" className="mt-4 flex flex-wrap gap-3">{HIRE_CATEGORIES.map(c=><Link key={c.slug} href={`/hire/${c.slug}`} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/65 hover:text-white">{c.name} London</Link>)}</nav>
    <details className="mt-7 rounded-xl border border-white/10 p-5"><summary className="cursor-pointer font-medium text-white/75">Browse the hire listing directory</summary><ul className="mt-5 grid gap-x-8 gap-y-3 text-sm text-white/60 sm:grid-cols-2 lg:grid-cols-3">{rows.map(r=><li key={r.slug}><Link className="hover:text-accent-400" href={`/gear/${r.slug}`}>{r.title}</Link></li>)}</ul></details>
  </section></CatalogRevisionGuard></>;
}
