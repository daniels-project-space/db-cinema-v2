const fallback = { message: "We couldn’t open verification. No new payment was taken. Try again, or contact the team below.", retryable: true };

const safeErrors: Array<[string, string, boolean]> = [
  ["closed two hours after its scheduled start", "This rental’s verification window has closed. If you think this is wrong, contact the team below.", false],
  ["Complete the rental payment and required card hold", "Finish payment and card setup before opening verification.", false],
  ["Complete the rental payment before opening verification", "Complete payment before opening verification. You won’t be charged again by retrying.", false],
  ["Please sign in to verify this booking", "Sign in to the account used for this rental, then try again.", false],
  ["This booking is not ready for verification", "This rental isn’t ready for verification yet. Refresh your rental or contact the team below.", false],
  ["Automatic verification is temporarily unavailable", "Verification is temporarily unavailable. Contact the team below before continuing.", true],
];

export function diditRenterOpenFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.replace(/^Uncaught Error:\s*/, "");
  const match = safeErrors.find(([fragment]) => normalized.includes(fragment));
  return match ? { message: match[1], retryable: match[2] } : fallback;
}
