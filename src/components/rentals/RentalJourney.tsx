"use client";
import { rentalProgress, type ProgressBooking } from "../../../shared/rentalProgress";
const stops = ["Booked", "Verified", "On rental", "Return check", "Completed"];
const paths = [
  <><path d="M6 3v4m12-4v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m8 14 2 2 5-5"/></>,
  <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  <><path d="M3 8h12v11H3zM15 11l6-3v11l-6-3M6 5h6M6 8V5"/><circle cx="8" cy="13" r="2.5"/></>,
  <><path d="M5 9a8 8 0 1 1-1 8M5 4v5H1"/><path d="m9 12 3 3 4-5"/></>,
  <><path d="m4 6 14-3 2 4L6 10 4 6ZM6 10h14v10H6zM9 5l3 4m3-5 3 4"/><path d="m10 15 2 2 4-4"/></>,
];
export function RentalJourney({ booking }: { booking: ProgressBooking }) {
  const p = rentalProgress(booking);
  return <section aria-label="Rental progress" className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.055] via-white/[.015] to-accent-400/[.04] px-3 py-4">
    {p.cancelled ? <p className="text-xs text-rose-300">{p.caption}</p> : <>
      <ol className="relative flex justify-between gap-1">
        {stops.map((label, i) => <li key={label} aria-current={i === p.index ? "step" : undefined} className={`relative flex min-w-0 flex-1 flex-col items-center gap-2 ${i <= p.index ? "text-accent-300" : "text-white/25"}`}>
          {i > 0 && <span aria-hidden className={`absolute right-1/2 top-4 h-px w-full ${i <= p.index ? "bg-accent-300/35" : "bg-white/10"}`}/>}
          <span className={`relative z-10 grid h-8 w-8 place-items-center rounded-xl bg-[#171918] ${i === p.index ? "ring-1 ring-accent-300/60 shadow-[0_0_20px_#acd17c20] motion-safe:animate-[pulse_4s_ease-in-out_infinite]" : "ring-1 ring-white/10"}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>{paths[i]}</svg></span>
          <span className="text-center text-[9px] leading-tight sm:text-[10px]">{label}</span>
        </li>)}
      </ol>
      <p role="status" className="mt-3 text-center text-[11px] text-white/65">{p.caption}</p>
    </>}
  </section>;
}
