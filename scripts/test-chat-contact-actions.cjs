const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load: loadProjectModule } = require("./lib/rentalTestHarness.cjs");
const chatLinks = loadProjectModule("src/lib/chatLinks.ts");
const supportActions = loadProjectModule("shared/gafferSupportActions.ts");

const duplicateEmailMessage = "Contact email: dbcinemarentals@gmail.com.\n\n[Email the team](mailto:dbcinemarentals@gmail.com)";
assert.equal(chatLinks.removeRedundantBusinessEmailLines(duplicateEmailMessage, "dbcinemarentals@gmail.com"), "\n[Email the team](mailto:dbcinemarentals@gmail.com)",
  "rental chat keeps one clear email button instead of an orphaned duplicate contact label");
assert.equal(chatLinks.removeRedundantBusinessEmailLines("Contact email: dbcinemarentals@gmail.com", "dbcinemarentals@gmail.com"), "Contact email: dbcinemarentals@gmail.com",
  "an email address stays visible when the message has no explicit email action");

const root = path.resolve(__dirname, "..");
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const emailLink = ({ label, className, ariaLabel }) => jsx("a", { href: "mailto:dbcinemarentals@gmail.com", className, "aria-label": ariaLabel, children: label });
const formatterSource = ts.transpileModule(fs.readFileSync(path.join(root, "src/components/chat/FormattedChatMessage.tsx"), "utf8"), {
  compilerOptions,
}).outputText;
const formatterMod = { exports: {} };
const loadFormatter = (name) => {
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
  if (name === "@/components/EmailLink") return { EmailLink: emailLink };
  throw new Error(`Unexpected formatter import: ${name}`);
};
new Function("require", "module", "exports", formatterSource)(loadFormatter, formatterMod, formatterMod.exports);

const sourcePath = path.join(root, "src/components/chat/ChatKit.tsx");
const source = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions,
}).outputText;
const mod = { exports: {} };
const load = (name) => {
  if (name === "react") return { useEffect() {}, useState(value) { return [value, () => {}]; } };
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
  if (name === "./BotAvatar") return { BotAvatarBadge() {} };
  if (name === "@/lib/site") return { CONTACT_EMAIL: "dbcinemarentals@gmail.com" };
  if (name === "@/lib/chatLinks") return chatLinks;
  if (name === "./FormattedChatMessage") return formatterMod.exports;
  throw new Error(`Unexpected import: ${name}`);
};
new Function("require", "module", "exports", source)(load, mod, mod.exports);

function anchors(node, result = []) {
  if (Array.isArray(node)) node.forEach((item) => anchors(item, result));
  else if (node && typeof node === "object") {
    if (typeof node.type === "function") return anchors(node.type(node.props), result);
    if (node.type === "a") result.push(node);
    anchors(node.props?.children, result);
  }
  return result;
}
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node.type === "function") return textOf(node.type(node.props));
  return textOf(node.props?.children);
}

const { ChatBubble, hasChatContactAction } = mod.exports;
assert.equal(supportActions.renterExplicitlyRequestedSupport("How can I email the team?"), true,
  "an explicit request for the contact channel is eligible");
assert.equal(supportActions.renterExplicitlyRequestedSupport("I don't need a human; what is the hire price?"), false,
  "a negated human mention is not mistaken for a support request");
assert.equal(supportActions.renterExplicitlyRequestedSupport("Could you email the team?"), true,
  "a direct request for the team to contact the renter is recognized");
assert.equal(supportActions.renterExplicitlyRequestedSupport("Could you recommend a camera?"), false,
  "ordinary gear questions are not mistaken for contact requests");
assert.equal(supportActions.renterExplicitlyRequestedSupport("Could you connect me with a person?"), true,
  "a direct request to be connected with a person is recognized");
assert.equal(supportActions.mayOfferGafferSupportActions({ latestCustomerMessage: "Thanks, that answers my question.", humanRequested: false, resolvedInquiry: true, asksDates: false, asksTimes: false, hasQuote: false }), false,
  "a solved, ordinary question does not receive an unsolicited contact action");
assert.equal(supportActions.mayOfferGafferSupportActions({ latestCustomerMessage: "Can you recommend a camera?", humanRequested: false, resolvedInquiry: false, asksDates: true, asksTimes: false, hasQuote: false }), false,
  "missing booking dates prompt a clarifying question rather than a support handoff");
assert.equal(supportActions.mayOfferGafferSupportActions({ latestCustomerMessage: "Can you recommend a camera?", humanRequested: false, resolvedInquiry: false, asksDates: false, asksTimes: false, hasQuote: false }), true,
  "an unresolved answer may offer the support route");
assert.equal(supportActions.mayOfferGafferSupportActions({ latestCustomerMessage: "Could you email the team?", humanRequested: false, resolvedInquiry: true, asksDates: false, asksTimes: false, hasQuote: false }), true,
  "an explicit customer request may offer contact even when the factual question was answered");
assert.equal(supportActions.mayOfferGafferSupportActions({ latestCustomerMessage: "That sounds good, thank you.", humanRequested: false, resolvedInquiry: true, asksDates: false, asksTimes: false, hasQuote: false }), false,
  "eligibility uses the actual renter message, not a model-generated support-request classification");
const gatedAnswer = supportActions.suppressIneligibleGafferSupportActions("The studio opens at 9am. [Open contact form](https://dbcinemarentals.com/contact) or email dbcinemarentals@gmail.com", false);
assert.equal(gatedAnswer, "The studio opens at 9am.", "the support CTA is removed while preserving the answered content");
assert.equal(supportActions.suppressIneligibleGafferSupportActions("I can help check that.\n\nhttps://www.dbcinemarentals.com/contact/?source=chat", false), "I can help check that.",
  "www/query aliases and bare contact URLs are removed from an otherwise resolved answer");
assert.equal(supportActions.suppressIneligibleGafferSupportActions("Email dbcinemarentals@gmail.com", false), "I can help with equipment, rental dates, availability and booking questions. What would you like to know?",
  "a bare business email is not leaked as an unsolicited support channel");
assert.equal(supportActions.suppressIneligibleGafferSupportActions("[Email the team](mailto:dbcinemarentals@gmail.com)", true), "[Email the team](mailto:dbcinemarentals@gmail.com)",
  "eligible email actions retain the canonical business mailbox");
const contact = anchors(ChatBubble({ role: "assistant", text: "Need us? [Open contact form](https://dbcinemarentals.com/contact)" }))[0];
assert.equal(contact.props.href, "/contact", "the contact CTA uses the site route");
assert.match(contact.props.className, /inline-flex/, "the contact route is visibly button-like");
assert.equal(contact.props.target, undefined, "the internal contact form opens in the current tab");
const relativeContact = anchors(ChatBubble({ role: "assistant", text: "[Open contact form](/contact)" }))[0];
assert.equal(relativeContact.props.href, "/contact", "a root-relative contact action is recognized and normalized to the site route");
assert.equal(relativeContact.props.target, undefined, "a root-relative internal contact action stays in the current tab");

const pastedContact = anchors(ChatBubble({ role: "assistant", text: "You can also reach us at https://dbcinemarentals.com/contact." }))[0];
assert.equal(pastedContact.props.href, "/contact", "a pasted contact URL becomes an internal action");
assert.equal(textOf(pastedContact.props.children), "Open contact form↗", "the pasted URL is replaced with a clear action label");
const wwwContact = anchors(ChatBubble({ role: "assistant", text: "https://www.dbcinemarentals.com/contact/" }))[0];
assert.equal(wwwContact.props.href, "/contact", "the www contact URL also stays inside the site");

const email = anchors(ChatBubble({ role: "assistant", text: "[Email the team](mailto:dbcinemarentals@gmail.com)" }))[0];
assert.equal(email.props.href, "mailto:dbcinemarentals@gmail.com");
assert.equal(email.props.target, undefined, "the mailto link uses the browser's configured mail handler without opening a blank tab");
assert.equal(email.props["aria-label"], "Email the team", "the email action has a clear accessible name");
assert.match(email.props.className, /underline/, "the email action is a compact, visibly identifiable text link");
assert.doesNotMatch(email.props.className, /inline-flex/, "the compact email link does not use the larger contact-button styling");

const pastedEmail = anchors(ChatBubble({ role: "assistant", text: "Email dbcinemarentals@gmail.com" }))[0];
assert.equal(pastedEmail.props.href, "mailto:dbcinemarentals@gmail.com", "a pasted approved email becomes an email action");
assert.equal(textOf(pastedEmail.props.children), "Email the team");
const duplicateContactActions = anchors(ChatBubble({ role: "assistant", text: "[Contact](https://dbcinemarentals.com/contact) or use [this contact form](https://dbcinemarentals.com/contact)." }));
assert.equal(duplicateContactActions.filter(anchor => anchor.props.href === "/contact").length, 1, "Repeated URLs create only one clickable action in the same message");
assert.doesNotMatch(textOf(ChatBubble({ role: "assistant", text: "[Contact](https://dbcinemarentals.com/contact) or use [this contact form](https://dbcinemarentals.com/contact)." })), /this contact form|\bor\b/, "Repeated contact actions and their connector are removed together");
const duplicateContactAliases = anchors(ChatBubble({ role: "assistant", text: "[Contact](https://dbcinemarentals.com/contact) or [open support](https://www.dbcinemarentals.com/contact/?from=chat)" }));
assert.equal(duplicateContactAliases.filter(anchor => anchor.props.href === "/contact").length, 1, "www, trailing-slash and query aliases collapse to one contact action");
assert.doesNotMatch(textOf(ChatBubble({ role: "assistant", text: "[Contact](https://dbcinemarentals.com/contact) or [open support](https://www.dbcinemarentals.com/contact/?from=chat)" })), /open support|\bor\b/, "The alias does not leave a second unclickable action label");
const repeatedContactParagraphs = ChatBubble({ role: "assistant", text: "[Open contact form](https://dbcinemarentals.com/contact)\n\n[Contact us](https://www.dbcinemarentals.com/contact/?source=chat)" });
assert.equal(anchors(repeatedContactParagraphs).filter(anchor => anchor.props.href === "/contact").length, 1, "Repeated contact actions across paragraphs still render as a single CTA");
assert.doesNotMatch(textOf(repeatedContactParagraphs), /Contact us/, "Deduplicating an action on a later line does not leave a second unclickable CTA label");
assert.equal(hasChatContactAction("Need help? https://dbcinemarentals.com/contact"), true);
assert.equal(hasChatContactAction("You can also email dbcinemarentals@gmail.com"), true);
assert.equal(hasChatContactAction("The retired inbox was bookings@dbcinemarentals.com"), false);
assert.equal(hasChatContactAction("A normal rental answer with no contact handoff"), false);

assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Email](mailto:someone-else@example.com)" })).length, 0,
  "unapproved mailboxes never become clickable chat actions");
assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Old inbox](mailto:bookings@dbcinemarentals.com)" })).length, 0,
  "the retired bookings mailbox never becomes a clickable chat action");
const external = anchors(ChatBubble({ role: "assistant", text: "[Continue verification](https://verify.didit.me/session/abc)" }))[0];
assert.equal(external.props.href, "https://verify.didit.me/session/abc", "approved provider links remain available");
assert.equal(external.props.target, "_blank");
assert.equal(external.props.rel, "noopener noreferrer", "external provider actions cannot access the opener");
const mapAction = anchors(ChatBubble({ role: "assistant", text: "https://www.google.com/maps/search/Trafalgar+Square" }))[0];
assert.equal(mapAction.props.href, "https://www.google.com/maps/search/Trafalgar+Square");
assert.equal(textOf(mapAction), "Open map↗", "Google Maps links are labelled as map actions instead of raw addresses");
assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Admin](https://dbcinemarentals.com/admin) [API](https://dbcinemarentals.com/api/account)" })).length, 0,
  "Gaffer never offers customer chat links to admin or API routes");
assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Form Seven](https://form7.net)" })).length, 0,
  "unapproved external destinations never become clickable chat links");
assert.match(textOf(ChatBubble({ role: "assistant", text: "[Form Seven](https://form7.net)" })), /Form Seven · unavailable/,
  "a rejected Markdown URL keeps its label while clearly showing it is unavailable");
assert.match(textOf(ChatBubble({ role: "assistant", text: "https://form7.net/private/path" })), /Link unavailable/,
  "a rejected bare URL does not leak a long raw target into the formatted conversation");
assert.doesNotMatch(textOf(ChatBubble({ role: "assistant", text: "https://form7.net/private/path" })), /form7\.net/);
assert.match(textOf(ChatBubble({ role: "assistant", text: "javascript:alert(1) //evil.example/path" })), /Link unavailable/,
  "unsafe schemes and protocol-relative URLs are displayed as compact unavailable-link labels");

const formattedMessage = ChatBubble({ role: "assistant", text: "**Quick answer**\n\nA separate paragraph.\nSecond line.\n\n- FX3 body\n- 24–70mm lens\n\n1. Check dates\n2. Add your kit" });
function nodesOfType(node, type, result = []) {
  if (Array.isArray(node)) node.forEach((item) => nodesOfType(item, type, result));
  else if (node && typeof node === "object") {
    if (typeof node.type === "function") return nodesOfType(node.type(node.props), type, result);
    if (node.type === type) result.push(node);
    nodesOfType(node.props?.children, type, result);
  }
  return result;
}
assert.equal(nodesOfType(repeatedContactParagraphs, "p").length, 1, "Removing a repeated CTA also removes its empty paragraph and the resulting vertical gap");
assert.equal(nodesOfType(formattedMessage, "p").length, 2, "blank lines produce distinct readable paragraphs");
assert.equal(nodesOfType(formattedMessage, "ul").length, 1, "unordered gear lists use semantic lists");
assert.equal(nodesOfType(formattedMessage, "ol").length, 1, "numbered steps use semantic lists");
assert.equal(nodesOfType(formattedMessage, "strong").length, 1, "Gaffer emphasis is rendered as real bold text");
const priceMessage = ChatBubble({ role: "assistant", text: "**Total: £1,240.00**. Delivery is £18.50.\n\nThe exceptional fixture value is $12345678901234567890." });
assert(nodesOfType(priceMessage, "div").some(node => /overflow-wrap:anywhere/.test(node.props.className ?? "")), "Long tokens can wrap inside the shared message formatter");
assert.match(textOf(priceMessage), /£1,240\.00.*£18\.50/, "Prices stay legible in bold and regular message text");

const rentalConversation = fs.readFileSync(path.join(root, "src/components/rentals/RentalConversation.tsx"), "utf8");
assert.match(rentalConversation, /resolveRentalChatLink\(rawUrl, suppliedLabel, \{ allowAdminNavigation \}\)/,
  "rental chat links pass through the role-aware route allowlist");
assert.match(rentalConversation, /return <FormattedChatMessage text=\{displayText\} resolveLink=\{resolveLink\} tone="rental" \/>/,
  "Renter, admin-rental and general support chat all render through the shared formatter");

const gaffer = fs.readFileSync(path.join(root, "src/lib/gaffer.ts"), "utf8");
assert.match(gaffer, /RESOLVE FIRST:[\s\S]*Do not use a contact link as a substitute for an answer or an available check/);
assert.match(gaffer, /Only if the customer explicitly asks to email us, provide \[Email the team\]\(mailto:\$\{CONTACT_EMAIL\}\)/);
assert.match(gaffer, /latestCustomerMessage:\s*lastUser/);
assert.doesNotMatch(gaffer, /supportRequested/);
assert.match(gaffer, /if \(!process\.env\.OPENROUTER_API_KEY\)[\s\S]*?The assistant isn't configured yet\.[\s\S]*?\[open the contact form\]\(\/contact\)/,
  "chat clients get an actionable contact form when Gaffer is not configured; email and voice callers retain their existing unavailable sentinel");
const botBubble = fs.readFileSync(path.join(root, "src/components/BotBubble.tsx"), "utf8");
assert.doesNotMatch(botBubble, /Keep chatting with Gaffer/, "the always-visible composer is not repeated as a duplicate button");
assert.doesNotMatch(botBubble, /hasChatContactAction\(m\.content\)/, "contact links do not create a second, unrelated chat action");
console.log("Chat formatting, safe contact actions, and duplicate controls passed.");
