import type { ReactNode } from "react";
import { SmartImage } from "@/components/SmartImage";

type MessageTone = "success" | "attention" | "neutral";

const toneClasses: Record<MessageTone, { card: string; icon: string; badge: string; dot: string }> = {
  success: {
    card: "border-emerald-200/20 bg-[radial-gradient(ellipse_at_top_left,rgba(110,231,183,.13),transparent_58%),linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.02))]",
    icon: "border-emerald-200/20 bg-emerald-200/[.08] text-emerald-100",
    badge: "border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100/90",
    dot: "bg-emerald-300",
  },
  attention: {
    card: "border-amber-200/20 bg-[radial-gradient(ellipse_at_top_left,rgba(252,211,77,.12),transparent_58%),linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.02))]",
    icon: "border-amber-200/20 bg-amber-200/[.08] text-amber-100",
    badge: "border-amber-200/20 bg-amber-200/[.07] text-amber-100/90",
    dot: "bg-amber-300",
  },
  neutral: {
    card: "border-sky-200/15 bg-[radial-gradient(ellipse_at_top_left,rgba(125,211,252,.1),transparent_58%),linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.02))]",
    icon: "border-sky-200/20 bg-sky-200/[.08] text-sky-100",
    badge: "border-sky-200/20 bg-sky-200/[.07] text-sky-100/90",
    dot: "bg-sky-300",
  },
};

function MessageGlyph({ kind }: { kind: "confirmation" | "decision" | "refund" | "reschedule" | "reminder" }) {
  return kind === "reminder"
    ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2M8 2.75h8"/></svg>
    : kind === "reschedule"
    ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="15.5" rx="2.5"/><path d="M7 3v5M17 3v5M3 10h18M9 15h3v3"/><path d="M12 15 9 18"/></svg>
    : kind === "refund"
    ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 14h2M15.5 17.5l-2-2 2-2M13.5 15.5H19"/></svg>
    : kind === "confirmation"
    ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/></svg>
    : <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12a2.5 2.5 0 0 1 2-2.5Z"/><path d="M14 4v4h4M9 12h6M9 16h4"/></svg>;
}

export function AutomatedRentalMessageCard({
  eyebrow,
  title,
  status,
  tone,
  kind,
  detailKind,
  items,
  itemCount,
  children,
}: {
  eyebrow: string;
  title: string;
  status: string;
  tone: MessageTone;
  kind: "confirmation" | "decision" | "reminder";
  detailKind?: "refund" | "reschedule";
  items?: { title: string; qty: number; heroImage?: string | null; imageSources?: string[] }[];
  itemCount?: number;
  children: ReactNode;
}) {
  const classes = toneClasses[tone];
  const imageItems = (items ?? []).filter((item) => item.heroImage || item.imageSources?.length);
  const singleItem = imageItems.length === 1;
  return <section data-testid="automated-rental-message-card" data-message-kind={kind} aria-label={`${eyebrow}: ${title}`} className={`mt-1 w-full max-w-[min(100%,36rem)] overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_14px_34px_rgba(0,0,0,.2)] backdrop-blur-2xl ${classes.card}`}>
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${classes.icon}`}><MessageGlyph kind={detailKind ?? kind}/></span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[.17em] text-white/45">{eyebrow}</p>
          <h4 className="mt-1 break-words text-sm font-semibold leading-snug text-white/95">{title}</h4>
        </div>
      </div>
      <span className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium leading-tight ${classes.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${classes.dot}`} aria-hidden="true"/>{status}
      </span>
    </header>
    {imageItems.length > 0 && <div className={`${singleItem ? "flex" : "grid grid-cols-2 sm:grid-cols-3"} mt-3 gap-2 border-t border-white/[.08] pt-3`}>
      {imageItems.map((item, index) => <article key={`${item.title}-${index}`} className={`${singleItem ? "flex items-center gap-3 p-2" : "overflow-hidden"} min-w-0 rounded-xl border border-white/[.08] bg-black/15`}>
        <SmartImage fit="cover" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className={`${singleItem ? "h-20 w-28 shrink-0 rounded-lg sm:h-24 sm:w-32" : "aspect-[4/3] w-full"} bg-white/[.025]`} />
        <div className={`${singleItem ? "flex min-w-0 flex-1 items-start justify-between gap-2 px-1" : "flex min-w-0 items-center justify-between gap-1 px-2 py-1.5"}`}><p className={`${singleItem ? "text-xs" : "text-[10px]"} min-w-0 break-words font-medium text-white/85`}>{item.title}</p><span className="shrink-0 text-[9px] text-white/45">×{item.qty}</span></div>
      </article>)}
      {typeof itemCount === "number" && itemCount > (items?.length ?? 0) && <p className="col-span-full text-[10px] text-white/45">+{itemCount - (items?.length ?? 0)} more listing{itemCount - (items?.length ?? 0) === 1 ? "" : "s"}</p>}
    </div>}
    <div className={detailKind ? "mt-4 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm leading-relaxed text-white/85 shadow-[inset_0_1px_rgba(255,255,255,.04)] [&_p]:my-0 [&_div]:min-w-0" : "mt-3 border-t border-white/[.08] pt-3 text-xs leading-relaxed text-white/75 [&_p]:my-0 [&_div]:min-w-0"}>{children}</div>
  </section>;
}
