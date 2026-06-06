"use client";

import type { Quote } from "@/lib/pricing";

export function DiscountLadder({ quote }: { quote: Quote }) {
  const { ladder, tier, next, saved } = quote;
  const currentIndex = ladder.findIndex((t) => t.days === tier.days);
  const n = ladder.length - 1;
  const fill =
    n > 0
      ? ((currentIndex + (next ? next.progress : 0)) / n) * 100
      : 100;

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-4">
      {/* track */}
      <div className="relative mx-1 mb-7 mt-2 h-1 rounded-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-1 rounded-full bg-gradient-to-r from-emerald-400 to-accent-400 transition-all duration-500"
          style={{ width: `${fill}%` }}
        />
        {ladder.map((t, i) => {
          const left = n > 0 ? (i / n) * 100 : 0;
          const achieved = i <= currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div
              key={t.days}
              className="absolute -translate-x-1/2"
              style={{ left: `${left}%`, top: "-5px" }}
            >
              <div
                className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                  isCurrent
                    ? "border-accent-300 bg-accent-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]"
                    : achieved
                      ? "border-emerald-400 bg-emerald-400"
                      : "border-white/20 bg-charcoal-900"
                }`}
              />
              <div
                className={`absolute left-1/2 mt-1.5 -translate-x-1/2 whitespace-nowrap text-center text-[9px] leading-tight ${
                  isCurrent ? "text-accent-300" : achieved ? "text-emerald-300/80" : "text-white/30"
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div>£{t.perDay}/d</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* contextual nudge */}
      {next ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2.5">
          <span className="mt-0.5 text-emerald-400">↑</span>
          <div className="text-xs leading-relaxed text-emerald-100/90">
            <span className="font-semibold text-emerald-300">
              {next.daysToNext} more day{next.daysToNext > 1 ? "s" : ""}
            </span>{" "}
            unlocks the <span className="font-semibold">{next.tier.label}</span>{" "}
            rate — {next.tier.days} days for{" "}
            <span className="font-semibold text-white">£{next.total}</span> (£
            {next.perDay}/day,{" "}
            <span className="text-emerald-300">save £{next.saved}</span> vs daily).
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2.5 text-xs text-emerald-200">
          🎉 Best rate unlocked — you’re on the {tier.label} rate.
        </div>
      )}

      {saved > 0 && (
        <div className="mt-2 text-center text-xs text-emerald-300/80">
          You’re saving <span className="font-semibold">£{saved}</span> vs the
          daily rate.
        </div>
      )}
    </div>
  );
}
