export type AccountControl = {
  id: string;
  label: string;
  description: string;
  terms: string;
  section: "rentals" | "billing" | "overview" | "membership" | "verification" | "documents" | "safety";
  view?: "history" | "actions" | "payments" | "invoices" | "credits" | "notes" | "restriction";
  rental?: boolean;
  selector?: string;
};

export const accountControls: AccountControl[] = [
  { id: "refund", label: "Refund rental", description: "Return a rental payment", terms: "return money reimburse reimbursement refund repay pay back charge card", section: "rentals", view: "actions", rental: true, selector: "rental-action-refund" },
  { id: "dates", label: "Change rental dates", description: "Reschedule this rental", terms: "reschedule move dates postpone timing change", section: "rentals", view: "actions", rental: true, selector: "rental-action-reschedule" },
  { id: "pickup", label: "Change pickup time", description: "Adjust collection time", terms: "pickup collection handover change time", section: "rentals", view: "actions", rental: true, selector: "rental-action-pickup-time" },
  { id: "return-time", label: "Change return time", description: "Adjust the return time", terms: "return dropoff drop off time change", section: "rentals", view: "actions", rental: true, selector: "rental-action-return-time" },
  { id: "add-item", label: "Add equipment", description: "Add an item to this rental", terms: "gear equipment add item extra kit", section: "rentals", view: "actions", rental: true, selector: "rental-action-add-item" },
  { id: "cancel", label: "Cancel rental", description: "Open cancellation options", terms: "cancellation cancel terminate booking", section: "rentals", view: "actions", rental: true, selector: "rental-action-cancel" },
  { id: "manage-rental", label: "Manage rental", description: "Extensions, delivery and item changes", terms: "extend extension delivery shipping item swap replacement change modify booking rental quote", section: "rentals", view: "actions", rental: true },
  { id: "history", label: "Rental history", description: "See this customer’s rentals", terms: "bookings previous past order history", section: "rentals", view: "history" },
  { id: "payments", label: "Saved-card claims", description: "View card claim controls", terms: "payment card charge late fee damage claim deposit hold", section: "billing", view: "payments" },
  { id: "invoices", label: "Invoices", description: "Find invoices and payment records", terms: "invoice receipt billing payment statement", section: "billing", view: "invoices" },
  { id: "credits", label: "Account credit", description: "Manage customer credit", terms: "credit balance store voucher issue money", section: "billing", view: "credits" },
  { id: "membership", label: "Membership & Encore", description: "Manage plan and tier", terms: "subscription member membership plan encore tier level upgrade downgrade", section: "membership" },
  { id: "verification", label: "Verification review", description: "Review a flagged verification", terms: "didit identity id document verify verification approval decline retry", section: "verification" },
  { id: "documents", label: "Documents", description: "View customer documents", terms: "documents files proof address identification id verification", section: "documents" },
  { id: "contact", label: "Contact details", description: "View or edit customer details", terms: "phone email name address customer contact details edit", section: "overview" },
  { id: "notes", label: "Customer notes", description: "View or add an internal note", terms: "notes comment memo internal", section: "safety", view: "notes" },
  { id: "restriction", label: "Account access", description: "Restrict or restore this account", terms: "ban block blacklist restrict unblock unban restore access account", section: "safety", view: "restriction" },
];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function distance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + Number(left[row - 1] !== right[column - 1]));
    previous = current;
  }
  return previous[right.length];
}

export function findAccountControls(query: string, controls = accountControls) {
  const normalized = normalize(query).slice(0, 100);
  if (!normalized) return controls;
  const stopWords = new Set(["a", "an", "the", "to", "for", "on", "of", "me", "my", "this", "that", "their", "how", "do", "i", "can", "please", "want", "need"]);
  const tokens = normalized.split(" ").filter(token => !stopWords.has(token)).slice(0, 8);
  if (!tokens.length) return controls;
  return controls.map(control => {
    const label = normalize(control.label);
    const words = normalize(`${control.label} ${control.description} ${control.terms}`).split(" ");
    let score = label.includes(normalized) ? 20 : 0;
    for (const token of tokens) {
      const best = Math.max(...words.map(word => word === token ? 8 : word.startsWith(token) && token.length >= 2 ? 5 : token.length >= 4 && distance(word, token) <= (token.length >= 5 ? 2 : 1) ? 2 : 0));
      if (!best) return { control, score: -1 };
      score += best;
    }
    return { control, score };
  }).filter(result => result.score >= 0).sort((left, right) => right.score - left.score).map(result => result.control);
}
