import { IconStar } from "@/components/icons";

export function HomeStats({
  ratingValue,
  reviewCountLabel,
}: {
  ratingValue: number;
  reviewCountLabel: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm text-white/50">
      <span className="flex gap-0.5 text-accent-400">
        {Array.from({ length: 5 }).map((_, i) => (
          <IconStar key={i} className="h-3.5 w-3.5" />
        ))}
      </span>
      <span className="font-mono font-semibold text-white/80">{ratingValue.toFixed(2)}/5</span>
      <span className="text-white/30">·</span>
      <span>{reviewCountLabel} renter reviews</span>
    </div>
  );
}
