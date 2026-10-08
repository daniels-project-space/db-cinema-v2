import { PICKUP_SLOTS } from "./site";

/** Tab-scoped convenience only. Prices, signatures and payment/consent attempt
 * IDs are deliberately never restored from this draft. */
export type CheckoutDraft = {
  email: string; name: string; phone: string; billingAddress: string;
  fulfilment: "pickup" | "delivery"; address: string; postcode: string;
  protection: "verify" | "deposit"; pickupTime: string; returnTime: string;
  agreed: boolean; deliveryAgreed: boolean;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export function browserCheckoutStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
const TTL = 24 * 60 * 60 * 1000;
export const checkoutDraftKey = (scope: string) => `dbc_checkout_draft_v1:${scope}`;

function fields(value: any): CheckoutDraft {
  const text = (key: string, max = 200) => typeof value[key] === "string" ? value[key].slice(0, max) : "";
  const slot = (key: string) => PICKUP_SLOTS.includes(value[key]) ? value[key] : "";
  return {
    email: text("email", 320), name: text("name"), phone: text("phone", 80),
    billingAddress: text("billingAddress", 2000), address: text("address", 2000), postcode: text("postcode", 20),
    fulfilment: value.fulfilment === "delivery" ? "delivery" : "pickup",
    protection: value.protection === "deposit" ? "deposit" : "verify",
    pickupTime: slot("pickupTime"), returnTime: slot("returnTime"),
    agreed: value.agreed === true, deliveryAgreed: value.deliveryAgreed === true,
  };
}

export function readCheckoutDraft(storage: Storage | null, scope: string, terms: string, now = Date.now()): CheckoutDraft | null {
  try {
    const raw = storage?.getItem(checkoutDraftKey(scope));
    if (!raw || raw.length > 20000) return null;
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Number.isSafeInteger(value.savedAt) ||
        value.savedAt > now + 60000 || now - value.savedAt > TTL || !value.fields || typeof value.fields !== "object") return null;
    const draft = fields(value.fields);
    if (value.terms !== terms) { draft.agreed = false; draft.deliveryAgreed = false; }
    return draft;
  } catch { return null; }
}

export function saveCheckoutDraft(storage: Storage | null, scope: string, terms: string, draft: CheckoutDraft, now = Date.now()) {
  try {
    storage?.setItem(checkoutDraftKey(scope), JSON.stringify({ version: 1, savedAt: now, terms, fields: fields(draft) }));
  } catch { /* Checkout remains usable if storage is unavailable. */ }
}
