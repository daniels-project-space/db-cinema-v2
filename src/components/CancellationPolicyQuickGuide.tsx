export function CancellationPolicyQuickGuide({ includeCompanyCancellation = true }: { includeCompanyCancellation?: boolean }) {
  const outcomes = [
    { label: "More than 7 days · refund", value: "100%", width: "77%", color: "bg-emerald-300" },
    { label: "7 days or less · credit", value: "100%", width: "77%", color: "bg-sky-300" },
    ...(includeCompanyCancellation ? [
      { label: "DB cancels · refund option", value: "100%", width: "77%", color: "bg-emerald-300" },
      { label: "DB cancels · credit option", value: "130%", width: "100%", color: "bg-accent-300" },
    ] : []),
  ];
  return (
    <section aria-labelledby="cancellation-quick-guide-title" className="cancel-policy-quick-guide my-8 rounded-3xl border border-accent-300/20 bg-white/[0.035] p-5 sm:p-6">
      <p className="text-[10px] font-medium uppercase tracking-[.2em] text-accent-300">In short · current rental terms</p>
      <h2 id="cancellation-quick-guide-title" className="mt-2 font-display text-xl font-semibold text-white">What happens if a rental is cancelled?</h2>
      <div role="img" aria-label={`Rental payment comparison: ${outcomes.map(outcome => `${outcome.label}, ${outcome.value}`).join("; ")}. Bars exclude separately quoted security amounts and membership fees.`} className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-[10px] uppercase tracking-[.12em] text-white/50">Value compared with your paid rental amount</p>
        {outcomes.map(outcome => <div key={outcome.label} className="grid grid-cols-[minmax(0,7.5rem)_minmax(3rem,1fr)_2.5rem] items-center gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(4rem,1fr)_3rem] sm:gap-3">
          <span className="text-[10px] leading-4 text-white/70 sm:text-xs">{outcome.label}</span>
          <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${outcome.color}`} style={{ width: outcome.width }} /></span>
          <strong className="text-right text-[10px] text-white sm:text-xs">{outcome.value}</strong>
        </div>)}
        <p className="text-[10px] leading-4 text-white/40">130% credit is subject to account policy. Deposits and membership fees are separate.</p>
      </div>
      <div className={`mt-5 grid gap-3 ${includeCompanyCancellation ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {includeCompanyCancellation && <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">DB Cinema cancels before pickup</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">All accounts can receive a full refund. Non-blocked accounts may instead choose 130% of remaining eligible rent as credit. Deposit returned separately.</p>
        </article>}
        <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">You cancel more than 7 days before the first start</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">Remaining rent refunded to the original payment method. Deposit returned separately.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white">You cancel 7 days or less before the first start</h3>
          <p className="mt-2 text-xs leading-5 text-white/65">Paid rent becomes account credit valid for 365 days—even within 48 hours. Deposit returned separately.</p>
        </article>
      </div>
      <p className="mt-4 text-[11px] leading-5 text-white/45">Day cutoffs use London calendar days from the first item start. Applies to rentals under v16; statutory refund rights take priority. Membership fees are separate.</p>
    </section>
  );
}
