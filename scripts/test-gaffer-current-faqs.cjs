const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./lib/rentalTestHarness.cjs");
const sharedKnowledge = load("shared/gafferPublicKnowledge.ts");
assert.equal(sharedKnowledge.isCancellationProtectionEnabled({ cancellationProtectionEnabled: true, assessmentSecurityEnabled: false }), false,
  "cancellation protection is unavailable unless the required assessment policy is active too");
assert.equal(sharedKnowledge.isCancellationProtectionEnabled({ cancellationProtectionEnabled: true, assessmentSecurityEnabled: true }), true);

const fixtureFaqs = [
  { q: "How does renting work?", a: "Old confirmation promise." },
  { q: "Do you deliver across London?", a: "Old delivery promise." },
  { q: "What about deposits and insurance?", a: "Default security wording." },
  { q: "How are the rates structured?", a: "Old discount claim." },
  { q: "What are your opening hours?", a: "Opening hours." },
  { q: "Can I extend or add to my booking?", a: "Old extension guarantee." },
  { q: "How do cancellations work?", a: "Old cancellation terms." },
];
const sourcePath = path.join(__dirname, "../src/lib/currentFaqs.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loadedModule = { exports: {} };
const moduleRequire = (identifier) => {
  if (identifier === "./guides") return { FAQS: fixtureFaqs };
  if (identifier === "./legal") return {
    ASSESSMENT_DEPOSIT_LEGAL_VERSION: "assessment-v",
    CARD_HOLD_LEGAL_VERSION: "card-hold-v",
    CANCELLATION_PROTECTION_LEGAL_VERSION: "cancellation-v",
    REFUNDABLE_DEPOSIT_LEGAL_VERSION: "cash-v",
    SETUP_INTENT_LEGAL_VERSION: "2026-11-v21",
    PREVIOUS_SETUP_INTENT_LEGAL_VERSION: "setup-previous-v",
    PREVIOUS_IMMEDIATE_CLAIM_LEGAL_VERSION: "2026-11-v22",
    IMMEDIATE_CLAIM_LEGAL_VERSION: "2026-11-v29",
    IMMEDIATE_CLAIM_LEGAL_VERSIONS: ["2026-11-v22", "2026-11-v23", "2026-11-v24", "2026-11-v25", "2026-11-v26", "2026-11-v27", "2026-11-v28", "2026-11-v29"],
    COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS: ["2026-11-v24", "2026-11-v25", "2026-11-v26", "2026-11-v27", "2026-11-v28", "2026-11-v29"],
    INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSIONS: ["2026-11-v23", "2026-11-v24", "2026-11-v25", "2026-11-v26", "2026-11-v27", "2026-11-v28", "2026-11-v29"],
    LESS_THAN_48_HOUR_CANCELLATION_LEGAL_VERSIONS: ["2026-11-v28", "2026-11-v29"],
  };
  if (identifier === "./currentLegalVersion") return {
    currentLegalVersion: async () => "2026-11-v29",
    legalVersionForPolicy: (policy) => policy.setupIntentSecurityEnabled ? "2026-11-v29" : policy.cardHoldSecurityEnabled ? "card-hold-v" : policy.assessmentSecurityEnabled ? (policy.cancellationProtectionEnabled ? "cancellation-v" : "assessment-v") : policy.refundableDepositEnabled ? "cash-v" : policy.version,
  };
  if (identifier === "../../shared/gafferPublicKnowledge") return sharedKnowledge;
  throw new Error(`Unexpected module dependency: ${identifier}`);
};
new Function("exports", "require", "module", compiled)(loadedModule.exports, moduleRequire, loadedModule);

const { faqsForLegalVersion, faqsForPolicy, getCurrentFaqs } = loadedModule.exports;
const answerFor = (faqs, question) => faqs.find((faq) => faq.q === question)?.a ?? "";
const questions = {
  workflow: "How does renting work?",
  delivery: "Do you deliver across London?",
  deposits: "What about deposits and insurance?",
  rates: "How are the rates structured?",
  changes: "Can I extend or add to my booking?",
  cancellations: "How do cancellations work?",
};

assert.match(answerFor(sharedKnowledge.FAQS, questions.workflow), /confirm the rental by email only after payment succeeds and required verification is approved/i,
  "the public default FAQ must gate confirmation on successful payment and verification");
assert.doesNotMatch(answerFor(sharedKnowledge.FAQS, questions.workflow), /confirmation by email, then collect/i);
assert.doesNotMatch(answerFor(sharedKnowledge.FAQS, questions.rates), /members save a further 10.?30%/i,
  "public FAQ must not promise a membership discount percentage that is not configured");

const setupFaqs = faqsForPolicy({ setupIntentSecurityEnabled: true });
const immediateFaqs = faqsForLegalVersion("2026-11-v24");
const currentImmediateFaqs = faqsForLegalVersion("2026-11-v29");
const previousImmediateFaqs = faqsForLegalVersion("2026-11-v23");
const previousBoundaryFaqs = faqsForLegalVersion("2026-11-v27");
assert.match(answerFor(setupFaqs, questions.workflow), /basket or Gaffer quote does not reserve stock/);
assert.match(answerFor(setupFaqs, questions.workflow), /account shows the status and next steps/);
assert.match(answerFor(setupFaqs, questions.workflow), /confirm the rental by email only after payment succeeds and required verification is approved/i);
assert.doesNotMatch(answerFor(setupFaqs, questions.workflow), /confirmation by email, then collect/i);
assert.match(answerFor(setupFaqs, questions.delivery), /eligible addresses/);
assert.match(answerFor(setupFaqs, questions.rates), /any account benefits eligible for that rental/);
assert.doesNotMatch(answerFor(setupFaqs, questions.rates), /members save a further 10.?30%/i);
assert.match(answerFor(setupFaqs, questions.changes), /not complete until your account shows the updated rental/);
assert.match(answerFor(setupFaqs, questions.deposits), /no deposit or card hold/);
assert.match(answerFor(setupFaqs, questions.deposits), /rises by £100 per extra £1,000/);
assert.match(answerFor(setupFaqs, questions.deposits), /final itemised invoice.*evidence/);
assert.match(answerFor(faqsForLegalVersion("2026-11-v25"), questions.deposits), /£200 at £4,000 or more/);
assert.match(answerFor(currentImmediateFaqs, questions.deposits), /rises by £100 per extra £1,000/);
assert.match(answerFor(setupFaqs, questions.cancellations), /cancelling seven or more London calendar days before the earliest equipment start/);
assert.match(answerFor(setupFaqs, questions.cancellations), /Cancelling at least 48 hours before scheduled pickup, but fewer than seven London calendar days/);
assert.match(answerFor(setupFaqs, questions.cancellations), /Cancelling less than 48 hours before scheduled pickup.*exactly 48 hours remains credit-only/);
assert.match(answerFor(immediateFaqs, questions.cancellations), /seven or more London calendar days before the earliest equipment start/);
assert.match(answerFor(immediateFaqs, questions.cancellations), /more than 48 hours before scheduled pickup, but fewer than seven London calendar days/);
assert.match(answerFor(immediateFaqs, questions.cancellations), /48 hours or less before scheduled pickup/);
assert.match(answerFor(immediateFaqs, questions.cancellations), /DB Cinema cancels a confirmed rental before pickup for any reason/);
assert.doesNotMatch(answerFor(immediateFaqs, questions.cancellations), /v23 terms|v24 terms/, "Current policy answers must not present an old introducing version as the current version");
assert.match(answerFor(previousImmediateFaqs, questions.cancellations), /equipment is unexpectedly unavailable/);
assert.doesNotMatch(answerFor(previousImmediateFaqs, questions.cancellations), /for any reason/);
assert.match(answerFor(previousBoundaryFaqs, questions.cancellations), /48 hours or less before scheduled pickup/,'v27 keeps its accepted inclusive 48-hour no-refund wording');
assert.doesNotMatch(answerFor(previousBoundaryFaqs, questions.cancellations), /exactly 48 hours remains credit-only/,'The v28 boundary change does not rewrite v27 Gaffer explanations');
assert.match(answerFor(faqsForLegalVersion("2026-11-v22"), questions.cancellations), /more than seven London calendar days before the earliest equipment start/);
assert.match(answerFor(faqsForLegalVersion("2026-11-v22"), questions.cancellations), /within seven or fewer London calendar days/);
assert.match(answerFor(faqsForLegalVersion("2026-11-v21"), questions.cancellations), /more than seven London calendar days before the earliest equipment start/);
assert.match(answerFor(faqsForLegalVersion("setup-previous-v"), questions.cancellations), /At seven days or less.*account credit/);
const cardHoldFaqs = faqsForPolicy({ cardHoldSecurityEnabled: true });
assert.match(answerFor(cardHoldFaqs, questions.deposits), /temporary card authorisation of £50 below £1,000/);
assert.match(answerFor(cardHoldFaqs, questions.deposits), /may reduce the card's available balance/);
assert.match(answerFor(faqsForLegalVersion("card-hold-v"), questions.deposits), /temporary card authorisation/);
assert.match(answerFor(faqsForLegalVersion("assessment-v"), questions.deposits), /No deposit waiver applies to a first rental/);
assert.match(answerFor(faqsForLegalVersion("cash-v"), questions.deposits), /No extra card hold is placed/);
const gafferSource = fs.readFileSync(path.join(__dirname, "../src/lib/gaffer.ts"), "utf8");
assert.match(gafferSource, /faqFacts = faqsForPolicy\(settings\)/);
assert.match(gafferSource, /CURRENT CUSTOMER FAQ/);
assert.match(gafferSource, /If the signed rule is not present, say you cannot verify this rental's exact terms/);
const supportGafferSource = fs.readFileSync(path.join(__dirname, "../convex/gaffer.ts"), "utf8");
assert.match(supportGafferSource, /CURRENT GENERAL CUSTOMER FAQ FACTS/);
assert.match(supportGafferSource, /recorded status and signed policy facts below take precedence/);
const currentFaqFactsSource = supportGafferSource.match(/function currentFaqFacts\(hours: string\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(currentFaqFactsSource, "Rental-chat Gaffer exposes its current-policy FAQ builder");
const currentFaqFactsJs = ts.transpileModule(currentFaqFactsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const currentFaqFacts = new Function("process", "faqsForSecurityPolicy", "isCancellationProtectionEnabled", `${currentFaqFactsJs}\nreturn currentFaqFacts;`)({
  env: {
    SETUP_INTENT_SECURITY_POLICY_ENABLED: "true",
    CARD_HOLD_SECURITY_POLICY_ENABLED: "false",
    ASSESSMENT_SECURITY_POLICY_ENABLED: "false",
    CANCELLATION_PROTECTION_POLICY_ENABLED: "false",
    REFUNDABLE_DEPOSIT_POLICY_ENABLED: "false",
  },
}, sharedKnowledge.faqsForSecurityPolicy, sharedKnowledge.isCancellationProtectionEnabled);
const currentRentalChatCancellation = currentFaqFacts("09:00–22:00, daily")
  .find((fact) => fact.startsWith(`${questions.cancellations} `)) ?? "";
assert.match(currentRentalChatCancellation, /seven or more London calendar days before the earliest equipment start/);
assert.match(currentRentalChatCancellation, /at least 48 hours before scheduled pickup, but fewer than seven London calendar days/);
assert.match(currentRentalChatCancellation, /less than 48 hours before scheduled pickup allows no rental refund or credit; exactly 48 hours remains credit-only/);
assert.match(currentRentalChatCancellation, /DB Cinema cancels a confirmed rental before pickup for any reason/);
assert.doesNotMatch(currentRentalChatCancellation, /v24 terms|unexpectedly unavailable/);
assert.match(supportGafferSource, /inclusiveSevenDayCancellationBoundary: currentImmediateClaimTerms/);
assert.match(supportGafferSource, /lessThan48HourCancellationBoundary: currentImmediateClaimTerms/);
assert.match(supportGafferSource, /companyCancellationForAnyReasonEnabled: currentImmediateClaimTerms/);
const supportChatSource = fs.readFileSync(path.join(__dirname, "../convex/chat.ts"), "utf8");
assert.match(supportChatSource, /checkoutUi:\{[^\n]*cancellationProtectionEnabled:isCancellationProtectionEnabled/,
  "rental-chat Gaffer uses the same combined live feature gate as checkout settings");
const contactStarter = fs.readFileSync(path.join(__dirname, "../src/components/gaffer/OpenGafferChat.tsx"), "utf8");
assert.match(contactStarter, /label: "Ask a question"/);
assert.match(contactStarter, /label: "Build a kit"/);
assert.match(contactStarter, /label: "Check dates"/);
assert.match(contactStarter, /label: "Get a quote"/);
assert.match(contactStarter, /dbc:open-gaffer-chat/);
const botBubble = fs.readFileSync(path.join(__dirname, "../src/components/BotBubble.tsx"), "utf8");
assert.match(botBubble, /dbc:open-gaffer-chat/);

getCurrentFaqs()
  .then((currentFaqs) => {
    assert.equal(answerFor(currentFaqs, questions.deposits), answerFor(setupFaqs, questions.deposits));
    assert.equal(answerFor(currentFaqs, questions.cancellations), answerFor(currentImmediateFaqs, questions.cancellations));
    console.log("PASS Gaffer and the public FAQ share versioned policy answers, cancellation date anchors, accurate checkout guidance, and guarded account changes.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
