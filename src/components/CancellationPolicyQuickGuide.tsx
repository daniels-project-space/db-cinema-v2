export function CancellationPolicyQuickGuide({ includeCompanyCancellation = true }: { includeCompanyCancellation?: boolean }) {
  return (
    <section aria-labelledby="cancellation-quick-guide-title" className="cancel-policy-quick-guide my-8 rounded-3xl border border-accent-300/20 bg-white/[0.035] p-5 sm:p-6">
      <p className="text-[10px] font-medium uppercase tracking-[.2em] text-accent-300">In short · current rental terms</p>
      <h2 id="cancellation-quick-guide-title" className="mt-2 font-display text-xl font-semibold text-white">What happens if a rental is cancelled?</h2>
      <div className={`mt-5 grid gap-3 ${includeCompanyCancellation ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {includeCompanyCancellation && <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">If DB Cinema cancels</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">If kit is unexpectedly unavailable before pickup, eligible renters choose a full rental refund or 130% of the eligible rental amount as account credit. The refundable deposit is returned separately.</p>
        </article>}
        <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">You cancel more than 7 London days before the first start</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">The remaining rental payment is refunded to its original payment method. The refundable deposit is returned separately.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">You cancel 7 London days or less before the first start</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">The remaining paid rental amount becomes account credit for 365 days, including within 48 hours. The refundable deposit is returned separately.</p>
        </article>
      </div>
      <p className="mt-4 text-[11px] leading-5 text-white/45">These terms apply to bookings that accepted version 2026-10-v16. Statutory refund rights take priority; membership fees are separate.</p>
    </section>
  );
}
