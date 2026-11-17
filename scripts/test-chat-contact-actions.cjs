const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src/components/chat/ChatKit.tsx");
const source = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const mod = { exports: {} };
const load = (name) => {
  if (name === "react") return { useEffect() {}, useState(value) { return [value, () => {}]; } };
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
  if (name === "./BotAvatar") return { BotAvatarBadge() {} };
  if (name === "@/lib/site") return { CONTACT_EMAIL: "dbcinemarentals@gmail.com" };
  throw new Error(`Unexpected import: ${name}`);
};
new Function("require", "module", "exports", source)(load, mod, mod.exports);

function anchors(node, result = []) {
  if (Array.isArray(node)) node.forEach((item) => anchors(item, result));
  else if (node && typeof node === "object") {
    if (node.type === "a") result.push(node);
    anchors(node.props?.children, result);
  }
  return result;
}

const { ChatBubble, hasChatContactAction } = mod.exports;
const contact = anchors(ChatBubble({ role: "assistant", text: "Need us? [Open contact form](https://dbcinemarentals.com/contact)" }))[0];
assert.equal(contact.props.href, "/contact", "the contact CTA uses the site route");
assert.match(contact.props.className, /inline-flex/, "the contact route is visibly button-like");
assert.equal(contact.props.target, undefined, "the internal contact form opens in the current tab");

const pastedContact = anchors(ChatBubble({ role: "assistant", text: "You can also reach us at https://dbcinemarentals.com/contact." }))[0];
assert.equal(pastedContact.props.href, "/contact", "a pasted contact URL becomes an internal action");
assert.equal(pastedContact.props.children, "Open contact form", "the pasted URL is replaced with a clear action label");
const wwwContact = anchors(ChatBubble({ role: "assistant", text: "https://www.dbcinemarentals.com/contact/" }))[0];
assert.equal(wwwContact.props.href, "/contact", "the www contact URL also stays inside the site");

const email = anchors(ChatBubble({ role: "assistant", text: "[Email the team](mailto:dbcinemarentals@gmail.com)" }))[0];
assert.equal(email.props.href, "mailto:dbcinemarentals@gmail.com");
assert.match(email.props.className, /inline-flex/, "the approved email action is visibly button-like");

const pastedEmail = anchors(ChatBubble({ role: "assistant", text: "Email dbcinemarentals@gmail.com" }))[0];
assert.equal(pastedEmail.props.href, "mailto:dbcinemarentals@gmail.com", "a pasted approved email becomes an email action");
assert.equal(pastedEmail.props.children, "Email the team");
assert.equal(hasChatContactAction("Need help? https://dbcinemarentals.com/contact"), true);
assert.equal(hasChatContactAction("You can also email dbcinemarentals@gmail.com"), true);
assert.equal(hasChatContactAction("The retired inbox was bookings@dbcinemarentals.com"), false);
assert.equal(hasChatContactAction("A normal rental answer with no contact handoff"), false);

assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Email](mailto:someone-else@example.com)" })).length, 0,
  "unapproved mailboxes never become clickable chat actions");
assert.equal(anchors(ChatBubble({ role: "assistant", text: "[Old inbox](mailto:bookings@dbcinemarentals.com)" })).length, 0,
  "the retired bookings mailbox never becomes a clickable chat action");
const external = anchors(ChatBubble({ role: "assistant", text: "[Form Seven](https://form7.net)" }))[0];
assert.equal(external.props.href, "https://form7.net", "other approved https links keep working");
assert.equal(external.props.target, "_blank");

const gaffer = fs.readFileSync(path.join(root, "src/lib/gaffer.ts"), "utf8");
assert.match(gaffer, /RESOLVE FIRST:[\s\S]*Do not use a contact link as a substitute for an answer or an available check/);
assert.match(gaffer, /Only if the customer explicitly asks to email us, provide \[Email the team\]\(mailto:\$\{CONTACT_EMAIL\}\)/);
const botBubble = fs.readFileSync(path.join(root, "src/components/BotBubble.tsx"), "utf8");
assert.match(botBubble, /Keep chatting with Gaffer/);
assert.match(botBubble, /composerRef\.current\?\.focus\(\)/);
console.log("Chat contact actions and resolve-first instructions passed.");
