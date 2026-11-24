const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "src/lib/chatNotificationOffer.ts");
const compiled = buildSync({ entryPoints: [helperPath], bundle: true, platform: "node", format: "cjs", write: false });
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = Module._nodeModulePaths(path.dirname(helperPath));
helperModule._compile(compiled.outputFiles[0].text, helperPath);
const { chatNotificationOfferKey, clearChatNotificationOfferDismissal, dismissChatNotificationOffer, isChatNotificationOfferDismissed, isChatNotificationOfferReady, latestAnsweredQuestionReplyId } = helperModule.exports;

const oldHistory = [
  { _id: "renter-old", sender: "renter", text: "An earlier question" },
  { _id: "bot-old", sender: "bot", text: "An earlier answer" },
];
assert.equal(latestAnsweredQuestionReplyId(oldHistory), "bot-old", "a fresh device can attach the prompt to the latest visible answer in the saved conversation");
const currentUnanswered = [...oldHistory, { _id: "renter-current", sender: "renter", text: "A new question" }];
assert.equal(latestAnsweredQuestionReplyId(currentUnanswered), null, "the prompt waits until Gaffer answers the renter's current question");
const currentAnswered = [...currentUnanswered, { _id: "bot-current", sender: "bot", text: "The current answer" }];
assert.equal(latestAnsweredQuestionReplyId(currentAnswered), "bot-current", "the prompt follows the answer to the latest renter question, not old history");
assert.equal(latestAnsweredQuestionReplyId([...currentAnswered, { _id: "renter-next", sender: "renter", text: "Another question" }]), null, "a later unanswered message never places the prompt before the answer");
const humanFirstAnswered = [
  { _id: "renter-human-first", sender: "renter", text: "Can someone help me?" },
  { _id: "owner-first-answer", sender: "owner", text: "Yes, I can help with that." },
];
assert.equal(latestAnsweredQuestionReplyId(humanFirstAnswered), "owner-first-answer", "an owner-first support reply also anchors the invitation after the renter has received an answer");
assert.equal(latestAnsweredQuestionReplyId([...humanFirstAnswered, { _id: "renter-follow-up", sender: "renter", text: "One more question" }]), null, "a human answer never causes the invitation to appear before the renter's next question is answered");
assert.equal(latestAnsweredQuestionReplyId([{ _id: "renter-question", sender: "renter", text: "Question" }, { _id: "system-note", sender: "system", text: "A system note" }]), null, "system messages are not treated as customer-facing answers");
assert.equal(isChatNotificationOfferReady("bot-current", null), false, "the notification invitation waits while the answer is still streaming");
assert.equal(isChatNotificationOfferReady("bot-current", "bot-old"), false, "a completed earlier answer cannot release the invitation for a new answer");
assert.equal(isChatNotificationOfferReady("bot-current", "bot-current"), true, "the invitation appears immediately after the current answer finishes streaming");

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const firstDevice = createStorage();
const secondDevice = createStorage();
assert.equal(isChatNotificationOfferDismissed("account-a", firstDevice), false, "the invitation stays visible while notification setup is open");
assert.equal(isChatNotificationOfferDismissed("account-b", firstDevice), false, "another renter on the same device remains eligible");
assert.equal(isChatNotificationOfferDismissed("account-a", secondDevice), false, "the renter can receive the offer on another device");
assert.equal(chatNotificationOfferKey("account-a"), "dbc_chat_notification_offer:account-a");
dismissChatNotificationOffer("account-a", firstDevice);
assert.equal(isChatNotificationOfferDismissed("account-a", firstDevice), true, "choosing Not now dismisses the invitation for that account and device");
clearChatNotificationOfferDismissal("account-a", firstDevice);
assert.equal(isChatNotificationOfferDismissed("account-a", firstDevice), false, "turning alerts back off makes the invitation eligible again");

const botBubble = fs.readFileSync(path.join(root, "src/components/BotBubble.tsx"), "utf8");
const rentalConversation = fs.readFileSync(path.join(root, "src/components/rentals/RentalConversation.tsx"), "utf8");
const notificationBell = fs.readFileSync(path.join(root, "src/components/account/RenterNotificationBell.tsx"), "utf8");
const permissionFlow = notificationBell.match(/async function enable\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
assert.equal((notificationBell.match(/Notification\.requestPermission\(\)/g) ?? []).length, 1, "browser permission is requested only once, inside the explicit enable flow");
assert.doesNotMatch(notificationBell.split("async function enable")[0], /Notification\.requestPermission\(\)/, "mounting the chat or opening settings never silently requests browser permission");
assert.match(notificationBell, /onClick=\{\(\)=>void enable\(\)\}/, "the browser permission request can only start from the renter's Enable button");
assert(permissionFlow.indexOf("await subscribe({token,deviceId,endpoint:json.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth})") < permissionFlow.indexOf("setConnected(true)"), "the UI reports alerts active only after the server accepts the device subscription");
assert.match(notificationBell, /onClick=\{async\(\)=>\{try\{await install\.prompt\(\)/, "app installation is optional and only starts from the explicit install button");
const storefrontSetupAction = botBubble.match(/function openNotificationSetup\(\)\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(storefrontSetupAction, /sessionStorage\.setItem\("dbc_open_chat_notification_settings", "1"\)/, "the storefront enable button hands off to the persistent notification setup");
assert.doesNotMatch(storefrontSetupAction, /dismissChatNotificationOffer|setNotificationOfferDismissed/, "opening setup does not dismiss the invitation");
assert.match(botBubble, /onClick=\{openNotificationSetup\}/, "the real storefront enable button uses the one-time handoff");
assert.match(botBubble, /const notificationPromptReplyId = accountThread \? latestAnsweredQuestionReplyId\(accountThread\) : null;/, "the prompt is anchored to the latest answered renter question, not stale account history");
assert.match(botBubble, /onStreamComplete=\{m\.id && m\.id === notificationPromptReplyId \? \(\) => setStreamedNotificationReplyId\(m\.id!\) : undefined\}/, "the exact answer completion releases the notification invitation");
assert.match(botBubble, /isChatNotificationOfferReady\(notificationPromptReplyId, streamedNotificationReplyId\)/, "the invitation waits until Gaffer's answer has finished typing");
assert.match(botBubble, /m\.id === notificationPromptReplyId/, "the chat-alert prompt is placed immediately after that answer");
assert.match(botBubble, /Open setup, then choose “Enable notifications\.” On iPhone or iPad, add this site to your Home Screen first\./, "the prompt explains the second permission step and iPhone setup accurately");
assert.match(botBubble, /<Link href="\/account#chat"[\s\S]*?>Open setup<\/Link>/, "the chat CTA opens the account notification setup rather than claiming to grant permission directly");
assert.doesNotMatch(botBubble, /Tap to enable|>Turn on notifications<\/Link>/, "chat copy does not imply the navigation tap itself enables browser permission");
const rentalInvitationAction = rentalConversation.match(/function dismissNotificationInvitation\(openSettings: boolean\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
assert.match(rentalInvitationAction, /if \(openSettings\)\s*\{\s*window\.dispatchEvent\(new Event\("dbc:open-renter-notifications"\)\);\s*return;/, "the in-chat enable action opens persistent notification settings");
assert.doesNotMatch(rentalInvitationAction.split("if (openSettings)")[1]?.split("dismissChatNotificationOffer")[0] ?? "", /dismissChatNotificationOffer|setNotificationInvitation/, "opening settings leaves the invitation visible until permission is active or Not now is chosen");
assert.match(rentalInvitationAction, /dismissChatNotificationOffer\(String\(invitationAccount\)\)[\s\S]*setNotificationInvitation\(\{ id: invitationId, visible: false \}\)/, "choosing Not now dismisses the in-chat invitation");
assert.ok(notificationBell.includes("const openFromChat=()=>{if(panelRef.current){panelRef.current.focus();return;}focusOnOpen.current=true;setOpen(true);};") && notificationBell.includes('window.addEventListener("dbc:open-renter-notifications",openFromChat)'), "the persistent bell opens setup without requiring the invitation to disappear");
assert.match(rentalConversation, /notificationInvitation\?\.id === String\(m\._id\) && notificationInvitation\.visible/, "only the anchored first-answer card is displayed in a rental conversation");
assert.match(rentalConversation, /notificationDesktop[^>]*>Open setup, then choose Enable notifications for this device\./, "desktop invitation copy is relevant to the current device");
assert.match(rentalConversation, /onClick=\{\(\) => dismissNotificationInvitation\(true\)\}>Open setup<\/button>/, "rental-chat CTA opens the notification panel without pretending to grant permission");

console.log("PASS chat notification invitation: first-answer anchor, persistent setup handoff, Not now dismissal, account/device scoping, and reset.");
