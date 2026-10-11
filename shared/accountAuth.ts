/** Expected authentication errors are safe to send to the renter via ConvexError. */
export const ACCOUNT_AUTH_MESSAGES = {
  INVALID_INPUT: "Enter a valid email address and your password.",
  INVALID_CREDENTIALS: "The email or password is incorrect. Check your email address, try again, or use Forgot password.",
  ACCOUNT_BLOCKED: "This account is blocked. Contact DB Cinema Rentals.",
  EMAIL_VERIFICATION_REQUIRED: "Confirm your signup email or request a private sign-in link first.",
  PASSWORD_NOT_SET: "Use an email sign-in link or Continue with Google for this account. You can also use Forgot password to set a password.",
  SIGNUP_INVALID_INPUT: "Enter a valid email and a password of 6+ characters.",
  ACCOUNT_EXISTS: "An account with that email already exists. Sign in or use Forgot password.",
} as const;

export function accountAuthError(code: keyof typeof ACCOUNT_AUTH_MESSAGES) {
  return { code, message: ACCOUNT_AUTH_MESSAGES[code] };
}

/** Do not display Convex request IDs, stack traces or internal error messages. */
export function accountAuthErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (data && typeof data === "object" && "code" in data && typeof data.code === "string" &&
        Object.prototype.hasOwnProperty.call(ACCOUNT_AUTH_MESSAGES, data.code)) {
      return ACCOUNT_AUTH_MESSAGES[data.code as keyof typeof ACCOUNT_AUTH_MESSAGES];
    }
  }
  return fallback;
}

export function validAccountEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
}
