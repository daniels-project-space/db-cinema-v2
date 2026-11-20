import previous from "./2026-11-v25";

// v26 keeps the signed v25 archive intact and clarifies the current saved-card
// claim ceiling, DB's choice whether to pursue a supported claim, and the
// itemised evidence invoice that must be sent before a card attempt.
const replacements: Array<[string, string]> = [
  [
    "The combined maximum for assessed late-return charges and severe, permanent cosmetic damage or loss is £50 when the combined equipment replacement value is below £1,000, £100 from £1,000 to below £4,000, and £200 at £4,000 or more.",
    "The combined ceiling for assessed late-return charges and severe, permanent cosmetic damage or loss is £50 when the combined equipment replacement value is below £1,000, £100 from £1,000 to below £4,000, and £200 at £4,000. Above £4,000, it increases continuously by £100 for each additional £1,000 of equipment value, calculated proportionally to the penny.",
  ],
  [
    "The combined maximum for assessed late-return charges and material, permanent cosmetic damage or loss beyond fair wear is £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more.",
    "The combined ceiling for assessed late-return charges and material, permanent cosmetic damage or loss beyond fair wear is £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000. Above £4,000, it increases continuously by £100 for each additional £1,000 of equipment value, calculated proportionally to the penny.",
  ],
  [
    "An authorised team member must record the permitted amount, specific reason and supporting evidence, send an itemised notice before the attempt, and may attempt one off-session collection immediately after notice within 30 days after the recorded return. The renter may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
    "DB may choose at its discretion whether to pursue a permitted claim and how much to claim, but only for a supported amount actually due under these terms and never above the agreed combined ceiling. Before any card attempt, an authorised team member records the specific reason, evidence and amount, and we send a final itemised claim invoice describing the late fee or damage, loss, repair or reasonable replacement, showing the calculation and including supporting evidence. After sending that invoice, DB may make one off-session collection attempt using the saved card within 30 days after the recorded return. You may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
  ],
  [
    "Before a permitted collection, an authorised team member must record the amount, reason and evidence and send an itemised notice. DB may then make one off-session collection attempt immediately, within 30 days after the recorded return. The renter may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
    "DB may choose at its discretion whether to pursue a permitted claim and how much to claim, but only for a supported amount actually due under these terms and never above the agreed combined ceiling. Before any card attempt, an authorised team member records the amount, reason and evidence and sends a final itemised claim invoice describing the late fee or damage, loss, repair or reasonable replacement, showing the calculation and including supporting evidence. After sending that invoice, DB may make one off-session collection attempt within 30 days after the recorded return. You may query or dispute the assessment at any time; statutory and bank dispute rights remain unchanged.",
  ],
  [
    "We give itemised evidence and notice before a permitted saved-card attempt and consider any query or dispute. Statutory and bank dispute rights remain unchanged.",
    "Before any permitted saved-card attempt, the final itemised claim invoice describes the damage, loss or late fee, shows the repair or reasonable replacement calculation and includes supporting evidence. We consider any query or dispute; statutory and bank dispute rights remain unchanged.",
  ],
];

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  ...(kind === "terms" ? { updated: "November 2026" } : {}),
  sections: document.sections.map(section => {
    let p = section.p;
    for (const [from, to] of replacements) p = p.replaceAll(from, to);
    return { ...section, p };
  }),
}])) as typeof previous;

current["deposit-agreement"] = {
  ...current["deposit-agreement"],
  sections: current["deposit-agreement"].sections.map(section => {
    if (section.h === "2. Future-claim ceiling and permitted reasons") {
      return { ...section, p: section.p.replace(
        "The combined maximum for assessed late-return charges and material, permanent cosmetic damage or loss beyond fair wear is £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more.",
        "The combined ceiling for assessed late-return charges and material, permanent cosmetic damage or loss beyond fair wear is £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000. Above £4,000, it increases continuously by £100 for each additional £1,000 of equipment value, calculated proportionally to the penny.",
      ).replace(
        "Late fees must use the agreed rate and actual recorded time.",
        "Late fees must use the agreed rate and actual recorded time. DB may choose whether to pursue a claim and how much to seek, at its discretion, but only up to the supported amount actually due and within this ceiling; the ceiling is not a fixed fee.",
      ) };
    }
    if (section.h === "3. Notice and one collection attempt") {
      return { ...section, p: "No amount is automatically charged for an on-time return without a reported issue. DB may decide at its discretion whether to pursue a permitted claim and how much to claim, but only for a supported amount actually due under these terms and never above the agreed combined ceiling. Before any card attempt, an authorised team member records the specific permitted reason, evidence and amount, and we send a final itemised claim invoice describing the late fee or damage, loss, repair or reasonable replacement, showing the calculation and including supporting evidence. After sending that invoice, DB may make one off-session collection attempt using the saved card within 30 days after the recorded return. Your bank may decline the payment or require authentication. You may query or dispute the assessment at any time, and your statutory and bank dispute rights remain unchanged. Any amount above this combined ceiling needs a separate agreement." };
    }
    return section;
  }),
};

export default current;
