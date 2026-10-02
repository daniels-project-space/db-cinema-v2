import { REVIEW_PRIZE_GBP } from "../../../../shared/reviewPrize";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  REVIEW_PRIZE_TERMS,
  REVIEW_SOCIAL,
} from "../../../../shared/reviewPrize";
export default function PrizeTerms() {
  const sections = [
    [
      "Promoter and eligibility",
      "DB Cinema Rentals, 25 Whitcomb Street, London WC2H 7ER, dbcinemarentals@gmail.com, promotes this skill-based set-story competition. Entrants must be UK residents aged 18 or over with an authenticated account and a genuine completed, returned website rental. Staff, judges and their immediate families cannot enter. No entry fee or additional purchase is required. One entry per rental; the same rental, review or social post cannot be entered in another round.",
    ],
    [
      "Refundable security condition",
      "Entry is available only after all refundable deposits, including later equipment additions, have been refunded in full and every security authorisation has been released without capture or deduction. A deposit kept for damage, loss or late charges, a captured security hold, partial or pending refund, or unresolved settlement makes that rental ineligible. We verify settlement against the payment provider and recheck eligibility before judging. A fully waived deposit with no required hold may qualify after the rental is returned and settled.",
    ],
    [
      "Deadlines and prize",
      `There is one £${REVIEW_PRIZE_GBP} GBP cash prize per round, two rounds per year. Entries close on 30 June and 31 December at 23:59:59 UK time. The first round under these rules closes on 31 December 2026. Complete the entry and upload evidence before the deadline. Winners are announced and notified within 14 days of closing and payment is due within 30 days of closing. The prize is paid as cash, not store credit. We contact the winner securely to agree payment details; no fee is payable to claim and we do not request card credentials.`,
    ],
    [
      "How to enter",
      `Submit an honest website review, a set-experience story of 150–3,000 characters, your Instagram handle, a public post/reel link and screenshot evidence through /rental-stories. Follow @${REVIEW_SOCIAL.handle}; share your actual set experience publicly, tag that account and clearly disclose #ad and that the post is a DB Cinema £${REVIEW_PRIZE_GBP} story-prize entry at the start of the post. Keep the post and follow available through judging. Google or third-party review sites are not required and do not form part of entry. Instagram does not sponsor, endorse or administer this competition.`,
    ],
    [
      "Honesty and disclosure",
      "Any honest star rating, including a critical review, is eligible. Positive sentiment, praise, star rating, followers and likes are not judging criteria. Website reviews linked to the competition are visibly labelled as incentivised prize entries and excluded from the ordinary aggregate rating. Do not conceal the incentive, invent a rental, copy another person's story or post content you do not have permission to share.",
    ],
    [
      "Evidence and progress",
      "Your account tracks return/security settlement, review and story, social evidence, judging and winner payment status. Your declaration is not automatic social verification: the team checks the submitted screenshot, public link, follow, tag and advertising disclosure. A correction or rejection includes a reason. All submitted evidence packs must be reviewed before a winner can be selected. Technical upload failures are shown; an entry counts only when the saved confirmation appears. Private screenshots are restricted to the entrant and authorised staff.",
    ],
    [
      "Independent judging",
      "An independent judge, or a panel including an independent member, scores every eligible entry for originality of the real story (0–50), useful craft or production insight (0–30) and clarity (0–20). Highest total wins; ties use originality, then earlier completed submission. The judge and reasons are recorded. Their name is made available with the announcement or on request. Ratings and positive sentiment are never scored. If no valid entry exists, no fictitious winner is declared; the round remains recorded and the promoter announces that result.",
    ],
    [
      "Winner publicity and your rights",
      "You keep ownership of your work. By entering you allow DB Cinema to display your submitted review and story, first name and round outcome on the competition page to document the judging and promote the set-story competition. Do not include confidential crew/client information or work you cannot share. We may request reasonable evidence of age, residency, rental and social steps before payout. We use account email for entry administration and winner communication. Marketing consent is separate and optional; unsubscribing does not affect an existing entry. Contact us about data access, objections or complaints.",
    ],
    [
      "Administration",
      `No automatic card charge or automatic bank transfer is made by this entry flow. Owner actions select the independently judged winner and record an actual £${REVIEW_PRIZE_GBP} transfer reference; the system tracks deadlines and sends reminders. We will not retrospectively change criteria or extend a closing date just to improve the entry pool. Fraudulent or ineligible entries may be excluded with a recorded reason. Nothing removes statutory rights. These terms are governed by the laws of England and Wales, without removing mandatory protections applying where you live.`,
    ],
  ];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <Link href="/rental-stories" className="text-sm text-amber-200">
          ← Set stories
        </Link>
        <h1 className="mt-6 font-display text-4xl text-white">
          £{REVIEW_PRIZE_GBP} set-story prize terms
        </h1>
        <p className="mt-3 text-xs text-white/40">
          {REVIEW_PRIZE_TERMS} · effective on entry
        </p>
        <div className="mt-10 space-y-8">
          {sections.map(([title, text]) => (
            <section key={title}>
              <h2 className="text-lg font-medium text-white">{title}</h2>
              <p className="mt-2 text-sm leading-7 text-white/60">{text}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
