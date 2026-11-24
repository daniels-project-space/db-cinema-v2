const SHARE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function checkoutCartUrl(shareKey: string, configuredAppUrl = process.env.APP_URL ?? "https://dbcinemarentals.com") {
  if (!SHARE_KEY_PATTERN.test(shareKey)) throw new Error("This rental kit link is invalid.");
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredAppUrl);
  } catch {
    throw new Error("The rental kit link is not configured securely.");
  }
  if ((baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && baseUrl.hostname === "localhost")) || baseUrl.username || baseUrl.password) {
    throw new Error("The rental kit link is not configured securely.");
  }
  return new URL(`/cart/quote/${shareKey}`, baseUrl.origin).toString();
}
