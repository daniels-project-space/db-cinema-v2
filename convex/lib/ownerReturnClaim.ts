"use node";

import { timingSafeEqual } from "node:crypto";
import { ConvexError } from "convex/values";

/** Require the separately held owner credential before creating any renter-money claim. */
export function assertOwnerReturnClaimToken(provided: string | undefined) {
  const configured = process.env.OWNER_RETURN_CLAIM_TOKEN ?? "";
  if (!/^[a-f0-9]{64}$/i.test(configured))
    throw new ConvexError({ code: "OWNER_RETURN_CLAIM_NOT_CONFIGURED", message: "Owner-only return claims are not configured. Remove the claim to complete a clean return." });
  const candidate = Buffer.from(provided ?? "", "utf8");
  const expected = Buffer.from(configured, "utf8");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
    throw new ConvexError({ code: "OWNER_RETURN_CLAIM_REQUIRED", message: "Only the account owner can authorize this money claim. No claim was recorded." });
}
