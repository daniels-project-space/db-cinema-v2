import previous from "./2026-11-v21";

// v22 changes only the timing of the saved-card claim workflow for future
// checkouts. v20/v21 snapshots remain archived with their seven-day process.
const replacements: Array<[string, string]> = [
  [
    "An authorised team member must record the specific reason and supporting evidence, provide an itemised notice, allow at least seven days to query or dispute it, and attempt any permitted collection within 30 days after the recorded return.",
    "An authorised team member must record the permitted amount, specific reason and supporting evidence, send an itemised notice before the attempt, and may attempt one off-session collection immediately after notice within 30 days after the recorded return. The renter may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
  ],
  [
    "Before any permitted collection, an authorised team member must record the reason and evidence, send an itemised notice, allow at least seven days to query or dispute it, and attempt collection within 30 days after the recorded return.",
    "Before a permitted collection, an authorised team member must record the amount, reason and evidence and send an itemised notice. DB may then make one off-session collection attempt immediately, within 30 days after the recorded return. The renter may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
  ],
  [
    "We give itemised evidence and notice before recovery, allow at least seven days to raise a dispute without limiting statutory rights, and consider your evidence.",
    "We give itemised evidence and notice before a permitted saved-card attempt and consider any query or dispute. Statutory and bank dispute rights remain unchanged.",
  ],
  [
    "If a permitted late-return or severe-damage/loss claim is assessed, its reason and evidence are recorded and an itemised notice is sent with at least seven days to query or dispute; collection is attempted within 30 days after the recorded return and only within the separate signed saved-card ceiling.",
    "If a permitted late-return or severe-damage/loss claim is assessed, its amount, reason and evidence are recorded and an itemised notice is sent before one off-session collection attempt. The attempt may happen immediately after notice and within 30 days after the recorded return, only within the separate signed saved-card ceiling. You may query or dispute the assessment at any time.",
  ],
  [
    "The completion statement records the decision and any charge; bank approval may still be declined or require authentication.",
    "The completion statement records the decision and any charge; bank approval may still be declined or require authentication. No replacement attempt is made automatically after a decline or a request for authentication.",
  ],
];

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  sections: document.sections.map(section => {
    let p = section.p;
    for (const [from, to] of replacements) p = p.replaceAll(from, to);
    return { ...section, p };
  }),
}])) as typeof previous;

current["deposit-agreement"] = {
  title: "Saved Card & Future Security Payments Agreement",
  updated: "November 2026",
  sections: [
    { h: "1. No deposit or card hold", p: "No security deposit is charged and no funds are reserved at checkout or pickup. Stripe securely saves the payment method for the limited future one-off claims described below. This is not a bank hold or a guarantee that a later payment will be authorised." },
    { h: "2. Future-claim ceiling and permitted reasons", p: "The combined maximum for assessed late-return charges and material, permanent cosmetic damage or loss beyond fair wear is £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more. Late fees must use the agreed rate and actual recorded time. Damage or loss must be itemised and supported by inspection, repair or reasonable replacement evidence, with deposits, recovered items and insurance recoveries deducted to prevent double recovery. Fair wear, pre-existing defects, routine dirt, minor removable marks, damage attributable to DB, insurance claims and policy excess are excluded from this permission." },
    { h: "3. Notice and one collection attempt", p: "No amount is automatically charged for an on-time return without a reported issue. After return, an authorised team member must record the specific permitted reason, evidence and amount, then send you an itemised notice before making one off-session collection attempt using the saved card. The attempt may happen immediately after notice and within 30 days after the recorded return. Your bank may decline the payment or require authentication; no replacement attempt is made automatically. You may query or dispute an assessment at any time, and your statutory and bank dispute rights remain unchanged. Any amount above this combined ceiling needs a separate agreement." },
    { h: "4. Insurance is separate", p: "Insurance claims and any policy excess are separate from this saved-card permission and ceiling. This permission does not authorise an insurance or excess charge; any such amount needs its own basis under the applicable insurance terms and must be separately itemised." },
  ],
};

export default current;
