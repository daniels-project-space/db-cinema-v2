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
    <div role="group" aria-label="Rental and review figures" className="mt-8 grid grid-cols-3 gap-2 border-t border-white/10 pt-6 sm:mt-12 sm:gap-3 sm:pt-8">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.025] px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.04)] sm:px-5 sm:py-5">
          <div className="whitespace-nowrap font-poster text-xl text-white min-[380px]:text-2xl sm:text-5xl">
            <CountUp value={stat.value} decimals={stat.decimals} suffix={stat.suffix} className="gradient-text" />
          </div>
          <div className="hud-label mt-1 text-[7px] min-[380px]:text-[8px] sm:mt-2 sm:text-xs">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
