const CURRENT_CANCELLATION_VERSIONS = ["2026-11-v21", "2026-11-v22", "2026-11-v23", "2026-11-v24", "2026-11-v25", "2026-11-v26", "2026-11-v27", "2026-11-v28", "2026-11-v29", "2026-11-v30", "2026-11-v31", "2026-11-v32", "2026-11-v33", "2026-11-v34"];

export function CancellationPolicyQuickGuide({
  includeCompanyCancellation = true,
  version = "2026-11-v18",
}: {
  includeCompanyCancellation?: boolean;
  version?: string;
}) {
  const currentPolicy = CURRENT_CANCELLATION_VERSIONS.includes(version);
  const inclusiveSevenDayBoundary = version === "2026-11-v23" || version === "2026-11-v24" || version === "2026-11-v25" || version === "2026-11-v26" || version === "2026-11-v27" || version === "2026-11-v28" || version === "2026-11-v29" || version === "2026-11-v30" || version === "2026-11-v31" || version === "2026-11-v32" || version === "2026-11-v33" || version === "2026-11-v34";
  const lessThan48HourBoundary = version === "2026-11-v28" || version === "2026-11-v29" || version === "2026-11-v33";
  const companyCancellationForAnyReason = version === "2026-11-v24" || version === "2026-11-v25" || version === "2026-11-v26" || version === "2026-11-v27" || version === "2026-11-v28" || version === "2026-11-v29" || version === "2026-11-v30" || version === "2026-11-v31" || version === "2026-11-v32" || version === "2026-11-v33" || version === "2026-11-v34";
  const companyCancellationLabel = companyCancellationForAnyReason ? "DB Cinema cancels" : "Equipment unexpectedly unavailable";
  const cancellationStages = currentPolicy
    ? [
        {
          range: inclusiveSevenDayBoundary ? "7+ days before first item starts" : "More than 7 days before first item starts",
          timing: "The seven-day window uses London calendar days",
          outcome: "Full refund",
          alternative: "or 100% account credit",
          cashPercent: 100,
          creditPercent: 100,
          choice: "Choose one",
          tone: "emerald",
        },
        {
          range: lessThan48HourBoundary ? "48 hours or more before pickup" : "More than 48 hours before pickup",
          timing: inclusiveSevenDayBoundary ? "But fewer than 7 days before the first item starts" : "And 7 days or less before the first item starts",
          outcome: "100% account credit",
          alternative: "No cash refund",
          cashPercent: 0,
          creditPercent: 100,
          choice: "Credit only",
          tone: "sky",
        },
        {
          range: lessThan48HourBoundary ? "Less than 48 hours before pickup" : "48 hours or less before pickup",
          timing: "The cutoff uses scheduled London pickup time",
          outcome: "No refund",
          alternative: "No account credit",
          cashPercent: 0,
          creditPercent: 0,
          choice: "No refund or credit",
          tone: "rose",
        },
      ]
    : [
        {
          range: "More than 7 days",
          timing: "Before the first item starts",
          outcome: "Full rental refund",
          alternative: "To the original payment method",
          cashPercent: 100,
          creditPercent: 0,
          choice: "Refund only",
          tone: "emerald",
        },
        {
          range: "7 days or less",
          timing: "Before the first item starts",
          outcome: "Account credit",
          alternative: "100% of the remaining rental value · valid 365 days",
          cashPercent: 0,
          creditPercent: 100,
          choice: "Credit only",
          tone: "sky",
        },
      ];

  return (
    <section aria-labelledby="cancellation-quick-guide-title" className="cancel-policy-quick-guide relative isolate mx-auto my-10 max-w-7xl overflow-hidden rounded-[30px] border border-accent-300/20 bg-[radial-gradient(ellipse_at_0%_0%,rgba(198,153,105,0.11),transparent_52%),linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 -z-10 h-80 w-80 rounded-full bg-accent-300/[.07] blur-3xl" />
      <div className="relative p-4 sm:p-7 lg:p-9">
        <header className="flex flex-col gap-4 border-b border-white/[.08] pb-5 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-accent-300/25 bg-accent-300/[.09] text-accent-200 shadow-[inset_0_1px_rgba(255,255,255,.14)] sm:h-14 sm:w-14">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 sm:h-7 sm:w-7" stroke="currentColor" strokeWidth="1.45"><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75v2.5m10-2.5v2.5M4.75 9h14.5M6.5 5.75h11A2.25 2.25 0 0 1 19.75 8v10A2.25 2.25 0 0 1 17.5 20.25h-11A2.25 2.25 0 0 1 4.25 18V8A2.25 2.25 0 0 1 6.5 5.75Z"/><path strokeLinecap="round" strokeLinejoin="round" d="m9 14 2 2 4-4"/></svg>
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-accent-300 sm:text-[11px]">Cancellation &amp; refunds</p>
              <h2 id="cancellation-quick-guide-title" className="mt-1 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl">If plans change</h2>
              <p className="mt-1 text-sm leading-5 text-white/60 sm:text-base">Your accepted rental terms set the options below.</p>
            </div>
          </div>
          <span className="ml-16 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[.035] px-3 py-2 text-[11px] font-medium text-white/65 sm:ml-0 sm:text-xs">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-accent-200"><path d="M5 7.5V6a5 5 0 0 1 10 0v1.5m-11 0h12v9H4v-9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M10 10.25v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            Based on accepted terms
          </span>
        </header>

        <div className="relative mt-6 sm:mt-8">
          <div aria-hidden="true" className="cancel-policy-timeline-rule pointer-events-none absolute left-[16.5%] right-[16.5%] top-2 hidden h-px bg-gradient-to-r from-emerald-200/35 via-sky-200/35 to-rose-200/35 lg:block" />
          <ol aria-label="Cancellation options in order of time before the rental" className="grid gap-3 lg:grid-cols-3 lg:gap-4 lg:pt-8">
            {cancellationStages.map((stage, index) => {
              const tone = stage.tone === "emerald"
                ? { border: "border-emerald-200/20", wash: "from-emerald-300/[.09]", text: "text-emerald-100", soft: "text-emerald-200/75", badge: "border-emerald-200/20 bg-emerald-300/[.08]", fill: "bg-emerald-300 shadow-[0_0_15px_rgba(110,231,183,.38)]", icon: "border-emerald-200/20 bg-emerald-300/[.08] text-emerald-200" }
                : stage.tone === "sky"
                  ? { border: "border-sky-200/20", wash: "from-sky-300/[.09]", text: "text-sky-100", soft: "text-sky-200/75", badge: "border-sky-200/20 bg-sky-300/[.08]", fill: "bg-sky-300 shadow-[0_0_15px_rgba(125,211,252,.38)]", icon: "border-sky-200/20 bg-sky-300/[.08] text-sky-200" }
                  : { border: "border-rose-200/20", wash: "from-rose-300/[.08]", text: "text-rose-100", soft: "text-rose-200/75", badge: "border-rose-200/20 bg-rose-300/[.08]", fill: "bg-rose-300 shadow-[0_0_15px_rgba(253,164,175,.35)]", icon: "border-rose-200/20 bg-rose-300/[.08] text-rose-200" };
              return <li key={stage.range} className={`relative flex min-w-0 flex-col rounded-[22px] border bg-gradient-to-br to-white/[.018] p-4 text-left shadow-[inset_0_1px_rgba(255,255,255,.045)] sm:p-5 lg:p-6 ${tone.border} ${tone.wash}`}>
                <span aria-hidden="true" className="pointer-events-none absolute -top-[17px] left-1/2 hidden h-[17px] w-px -translate-x-1/2 bg-accent-200/25 lg:block" />
                <span aria-hidden="true" className="cancel-policy-timeline-marker pointer-events-none absolute -top-[31px] left-1/2 hidden h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-accent-200/80 bg-[#121212] shadow-[0_0_0_4px_rgba(212,172,107,.08)] lg:block" />
                <div className="flex items-center justify-between gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${tone.icon}`}>
                    {index === 2
                      ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="13" r="7.25"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4l2.6 1.6M9 2.75h6m-3 0v2.5"/></svg>
                      : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75v2.5m10-2.5v2.5M4.75 9h14.5M6.5 5.75h11A2.25 2.25 0 0 1 19.75 8v10A2.25 2.25 0 0 1 17.5 20.25h-11A2.25 2.25 0 0 1 4.25 18V8A2.25 2.25 0 0 1 6.5 5.75Z"/>{index === 0 && <path strokeLinecap="round" strokeLinejoin="round" d="m9 14 2 2 4-4"/>}{index === 1 && <path strokeLinecap="round" strokeLinejoin="round" d="m9 13 2 2 4-4"/>}</svg>}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1.5 text-[10px] font-semibold ${tone.badge} ${tone.text}`}>{stage.choice}</span>
                </div>
                <h3 data-testid="cancellation-stage-range" className="mt-4 min-w-0 font-display text-lg font-semibold leading-snug text-white sm:text-xl lg:min-h-14">{stage.range}</h3>
                <p data-testid="cancellation-stage-timing" className="mt-1 min-h-10 text-xs leading-5 text-white/55 sm:text-sm lg:min-h-14">{stage.timing}</p>

                <div data-testid="cancellation-stage-amount" className="mt-4 rounded-2xl border border-white/[.08] bg-black/20 p-3.5 sm:p-4" aria-label={`Return amount for ${stage.range}`}>
                  <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                    <span className="text-white/65">Rental value returned</span>
                    <span className="font-semibold tabular-nums text-white">{Math.max(stage.cashPercent, stage.creditPercent)}%</span>
                  </div>
                  <div role="progressbar" aria-label={`Rental value returned under ${stage.range}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(stage.cashPercent, stage.creditPercent)} aria-valuetext={`${Math.max(stage.cashPercent, stage.creditPercent)}% of rental value, by the option shown`} className="h-2.5 overflow-hidden rounded-full bg-black/55 ring-1 ring-inset ring-white/[.1]">
                    <span aria-hidden="true" className={`block h-full rounded-full transition-[width] duration-500 ${tone.fill}`} style={{ width: `${Math.max(stage.cashPercent, stage.creditPercent)}%` }} />
                  </div>
                </div>
                <div data-testid="cancellation-stage-outcome" className="mt-4 lg:min-h-[4.5rem]">
                  <p className={`font-display text-lg font-semibold leading-snug ${tone.text} sm:text-xl`}>{stage.outcome}</p>
                  <p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">{stage.alternative}</p>
                </div>
              </li>;
            })}
          </ol>
        </div>

        {includeCompanyCancellation && <div className="mt-4 grid gap-3 rounded-[22px] border border-accent-300/25 bg-[linear-gradient(110deg,rgba(211,164,112,.11),rgba(255,255,255,.025)_55%,rgba(211,164,112,.045))] p-4 sm:mt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5 lg:p-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent-300">Separate protection</p>
            <h3 className="mt-1 text-base font-semibold text-white sm:text-lg">{companyCancellationForAnyReason ? "If DB Cinema cancels" : "If equipment is unexpectedly unavailable"}</h3>
            <p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">{companyCancellationForAnyReason ? "Confirmed rental cancelled before pickup: full refund or eligible 130% account credit." : "If equipment is unexpectedly unavailable and DB cancels before pickup: full refund or eligible 130% account credit."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[300px]">
            <div className="rounded-2xl border border-emerald-200/15 bg-emerald-300/[.06] px-3 py-2.5">
              <p className="text-[10px] text-white/55">To your card</p>
              <p className="mt-0.5 text-sm font-semibold text-emerald-100">100% refund</p>
            </div>
            <div className="rounded-2xl border border-accent-300/20 bg-accent-300/[.07] px-3 py-2.5">
              <p className="text-[10px] text-white/55">Account credit</p>
              <p className="mt-0.5 text-sm font-semibold text-accent-200">130%</p>
            </div>
          </div>
        </div>}

        <div className="mt-5 flex flex-col gap-2 border-t border-white/[.09] pt-4 text-xs leading-5 text-white/50 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p>{currentPolicy ? "London time: seven-day window uses first item start; 48-hour cutoff uses scheduled pickup." : "Timing follows the cancellation terms accepted with your rental."} Security and membership fees are separate.</p>
          <p>Restricted or rejected accounts cannot receive 130% credit. Statutory rights apply. Existing rentals keep accepted terms.</p>
        </div>
      </div>
    </section>
  );
}
