import { contentsFor } from "../../../shared/rentalContents";

export function RentalContentsList({ listing }: { listing: Parameters<typeof contentsFor>[0] }) {
  const contents = contentsFor(listing);
  const review = contents.inventoryFacts?.reviewRequired === true;
  const verified = contents.inventoryFacts?.contents ?? [];
  const shown = review ? verified : contents.includes;
  return (
    <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.02] p-5" aria-label="What is included with this rental">
      <h2 className="text-base font-medium text-white">What’s included</h2>
      {review && <p className="mt-3 text-sm leading-6 text-amber-200">Some accessories need confirmation. Ask us if you need any of the details below.</p>}
      {shown.length ? <ul className="mt-4 grid gap-x-5 gap-y-2.5 text-sm leading-6 text-white/70 sm:grid-cols-2">{shown.map((item,i)=><li key={i} className="flex gap-2"><span aria-hidden="true" className="text-emerald-300">✓</span><span>{item}</span></li>)}</ul> : <p className="mt-3 text-sm leading-6 text-white/55">Ask DB to confirm the supplied accessories before booking.</p>}
      {review && contents.includes.length > 0 ? <details className="mt-4 border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs font-medium text-white/65">Seller’s packing details · confirm if needed</summary><ul className="mt-3 grid gap-x-5 gap-y-2 text-sm leading-6 text-white/65 sm:grid-cols-2">{contents.includes.map((item,i)=><li key={i}>{item}</li>)}</ul></details> : !review && verified.length > 0 && contents.includes.join(";") !== verified.join(";") ? <details className="mt-4 border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs font-medium text-white/65">Equipment details</summary><ul className="mt-3 grid gap-x-5 gap-y-2 text-sm leading-6 text-white/65 sm:grid-cols-2">{verified.map((item,i)=><li key={i}>{item}</li>)}</ul></details> : null}
      {contents.optional.length > 0 && <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-xs font-medium text-white/65">Optional · arrange separately</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-white/55">{contents.optional.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
      {contents.excludes.length > 0 && <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-xs font-medium text-amber-200">Not included</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-white/55">{contents.excludes.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
      {contents.notes.length > 0 && <ul className="mt-4 space-y-2 text-xs leading-5 text-white/45">{contents.notes.map((note,i)=><li key={i}>{note}</li>)}</ul>}
    </section>
  );
}
