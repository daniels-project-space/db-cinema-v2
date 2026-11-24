import type { LegalDoc } from "../../../shared/legalDocuments";
import { CancellationPolicyQuickGuide } from "@/components/CancellationPolicyQuickGuide";

function sectionId(index: number) {
  return `cancellation-policy-section-${index + 1}`;
}

export function CancellationExplainerPage({
  doc,
  version,
  showQuickGuide,
}: {
  doc: LegalDoc;
  version: string;
  showQuickGuide: boolean;
}) {
  return (
    <main className="section-window relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(205,160,112,.13),rgba(205,160,112,0)_68%)] blur-3xl" />
      <div className="relative mx-auto max-w-[1320px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-10 lg:pb-24 lg:pt-16">
        <header className="relative isolate overflow-hidden rounded-[30px] border border-white/[.11] bg-[linear-gradient(120deg,rgba(35,29,24,.94),rgba(17,17,18,.97)_54%,rgba(26,23,20,.92))] shadow-[0_28px_100px_rgba(0,0,0,.36)] sm:rounded-[38px]">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-36 h-[28rem] w-[28rem] rounded-full border border-accent-300/[.12] shadow-[0_0_0_38px_rgba(205,160,112,.025),0_0_0_82px_rgba(205,160,112,.02)]" />
          <div className="relative grid gap-7 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-end lg:gap-12 lg:p-12">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-300/20 bg-black/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.2em] text-accent-200 sm:text-[11px]">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5"><path d="M5.5 2.75v2m9-2v2m-11 2.5h13M5.25 4.75h9.5a2.25 2.25 0 0 1 2.25 2.25v8a2.25 2.25 0 0 1-2.25 2.25h-9.5A2.25 2.25 0 0 1 3 15V7a2.25 2.25 0 0 1 2.25-2.25Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/><path d="m7 11 2 2 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Rental policy
              </div>
              <h1 className="mt-5 max-w-3xl break-words font-display text-4xl font-semibold leading-[1.02] tracking-[-.045em] text-white sm:text-5xl lg:text-6xl">
                {doc.title}
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-white/65 sm:text-base sm:leading-7">
                Review the options for this agreement, then read the complete wording below.
              </p>
              <a href="#full-policy-wording" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full border border-accent-200/35 bg-accent-300/[.13] px-5 py-2.5 text-sm font-semibold text-accent-100 shadow-[inset_0_1px_rgba(255,255,255,.12)] transition hover:border-accent-100/60 hover:bg-accent-300/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-200">
                Read the full terms
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            </div>

            <aside aria-label="Policy version details" className="grid grid-cols-2 gap-2 rounded-[22px] border border-white/[.1] bg-black/25 p-3 backdrop-blur-xl sm:gap-3 sm:p-4 lg:grid-cols-1 lg:p-5">
              <div className="rounded-2xl border border-white/[.08] bg-white/[.035] p-3 sm:p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Agreement version</p>
                <p className="mt-2 break-all font-mono text-xs font-medium text-white/85 sm:text-sm">{version}</p>
              </div>
              <div className="rounded-2xl border border-white/[.08] bg-white/[.035] p-3 sm:p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Last updated</p>
                <p className="mt-2 text-sm font-medium text-white/85">{doc.updated}</p>
              </div>
              <a href="#full-policy-wording" className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] px-3 py-3 text-xs text-white/60 transition hover:border-accent-200/25 hover:text-white sm:px-4 lg:col-span-1">
                <span>{doc.sections.length} sections · Full wording</span>
                <span aria-hidden="true" className="text-accent-200">↓</span>
              </a>
            </aside>
          </div>
          <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-accent-200/40 to-transparent" />
        </header>

        {showQuickGuide && <div className="mt-7 sm:mt-10">
          <CancellationPolicyQuickGuide version={version} />
        </div>}

        <section id="full-policy-wording" aria-labelledby="full-policy-heading" className="mx-auto mt-10 max-w-5xl scroll-mt-24 sm:mt-14">
          <div className="mb-5 flex flex-col gap-4 border-b border-white/[.1] pb-5 sm:mb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-accent-300">The agreement</p>
              <h2 id="full-policy-heading" className="mt-2 font-display text-2xl font-semibold tracking-[-.025em] text-white sm:text-3xl">Full policy wording</h2>
            </div>
            <p className="max-w-md text-xs leading-5 text-white/45 sm:text-right sm:text-sm">This text is shown as written in the selected agreement version.</p>
          </div>

          {doc.sections.length > 1 && <nav aria-label="Policy sections" className="mb-5 flex flex-wrap gap-2 sm:mb-7">
            {doc.sections.map((section, index) => (
              <a key={section.h} href={`#${sectionId(index)}`} className="max-w-full rounded-full border border-white/[.1] bg-white/[.035] px-3.5 py-2 text-xs leading-5 text-white/65 transition hover:border-accent-200/35 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-200 sm:text-sm">
                {section.h}
              </a>
            ))}
          </nav>}

          <div className="space-y-3 sm:space-y-4">
            {doc.sections.map((section, index) => (
              <article id={sectionId(index)} key={`${index}-${section.h}`} className="group scroll-mt-24 rounded-[22px] border border-white/[.09] bg-[linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018))] p-4 shadow-[inset_0_1px_rgba(255,255,255,.045)] sm:rounded-[26px] sm:p-6 lg:p-7">
                <div className="flex items-start gap-3 sm:gap-4">
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent-200/20 bg-accent-200/[.075] font-mono text-xs text-accent-200 sm:h-10 sm:w-10 sm:rounded-2xl">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-display text-lg font-semibold leading-snug text-white sm:text-xl">{section.h}</h3>
                    <p className="mt-3 break-words text-sm leading-7 text-white/65 [overflow-wrap:anywhere] sm:mt-4 sm:text-[15px] sm:leading-8">{section.p}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
