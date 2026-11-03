import { CountUp } from "@/components/CountUp";

export function HomeStats({
  ratingValue,
  reviewCount,
  itemCount,
}: {
  ratingValue: number;
  reviewCount: number;
  itemCount: number;
}) {
  const stats = [
    { value: ratingValue, decimals: 2, suffix: "", label: "profile rating" },
    { value: reviewCount, decimals: 0, suffix: "+", label: "renter reviews" },
    ...(itemCount > 0 ? [{ value: itemCount, decimals: 0, suffix: "", label: "items for hire" }] : []),
  ];

  return (
    <div role="group" aria-label="Rental and review figures" className="mt-12 grid grid-cols-1 gap-3 border-t border-white/10 pt-8 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
          <div className="font-poster text-4xl text-white sm:text-5xl">
            <CountUp value={stat.value} decimals={stat.decimals} suffix={stat.suffix} className="gradient-text" />
          </div>
          <div className="hud-label mt-2">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
