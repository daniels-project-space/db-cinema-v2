import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { studioDeliveryAvailable } from "./lib/memberDelivery";
import { monthlyCreditPence, tierByKey, MEMBERSHIP_TERMS_VERSION } from "../shared/membership";

const intro = v.union(v.literal("trial"), v.literal("credit"), v.literal("none"));

/** Convex serializes these transactions: two tabs cannot open two subscriptions. */
export const reserveCheckout = internalMutation({
  args: { accountId: v.id("accounts"), tier: v.string(), intro, requestId: v.string(), termsVersion: v.string() },
  handler: async (ctx, a) => {
    if (!tierByKey(a.tier)) throw Error("Unknown membership plan.");
    if (a.termsVersion !== MEMBERSHIP_TERMS_VERSION) throw Error("Accept the current membership terms.");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Please sign in again.");
    const rows = await ctx.db.query("membership_checkouts").withIndex("by_account", q => q.eq("accountId", a.accountId)).collect();
    const existing = rows.find(r => ["creating", "open"].includes(r.state) && r.expiresAt > Date.now());
    if (existing) {
      if (existing.requestId === a.requestId && existing.tier === a.tier && existing.intro === a.intro) return existing;
      throw Error("You already have a membership checkout open. Complete it or wait for it to expire.");
    }
    if (a.intro === "credit") throw Error("The welcome credit offer is no longer available. Choose the free first week or start a paid membership.");
    if (account.membershipActive || account.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(account.membershipStatus ?? ""))
      throw Error("Manage your existing membership in account settings.");
    if (a.intro !== "none" && account.membershipIntroUsed) throw Error("The introductory offer is available once per customer.");
    const id = await ctx.db.insert("membership_checkouts", {
      ...a, createdAt: Date.now(), expiresAt: Date.now() + 35 * 60_000, state: "creating", consentAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  },
});
export const bindCheckout = internalMutation({
  args: { id: v.id("membership_checkouts"), sessionId: v.string(), bookingId: v.optional(v.id("bookings")) },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.state === "expired") throw Error("Membership checkout expired.");
    if (row.sessionId && row.sessionId !== a.sessionId) throw Error("Membership checkout already bound.");
    await ctx.db.patch(row._id, { sessionId: a.sessionId, state: row.state === "complete" ? "complete" : "open", ...(a.bookingId ? { bookingId: a.bookingId } : {}) });
  },
});
export const abandonCheckout = internalMutation({
  args: { id: v.id("membership_checkouts") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (r && r.state === "creating" && !r.sessionId) await ctx.db.patch(id, { state: "expired" });
  },
});

/** Only a server-retrieved Stripe subscription may call this internal mutation. */
export const syncSubscription = internalMutation({
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), tier: v.string(), status: v.string(), subscriptionCreatedAt: v.number(), trialEnd: v.optional(v.number()), cancelAtPeriodEnd: v.boolean(), paidThrough: v.optional(v.number()), checkoutId: v.optional(v.id("membership_checkouts")) },
  handler: async (ctx, a) => {
    if (!tierByKey(a.tier)) throw Error("Unknown Stripe membership plan.");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Membership account is missing.");
    if (account.membershipSubscriptionCreatedAt && account.membershipSubscriptionCreatedAt > a.subscriptionCreatedAt) return;
    if (account.stripeSubscriptionId && account.stripeSubscriptionId !== a.subscriptionId && account.membershipActive)
      throw Error("Account already has another active subscription.");
    if (a.checkoutId) {
      const checkout = await ctx.db.get(a.checkoutId);
      if (!checkout || checkout.accountId !== a.accountId || checkout.tier !== a.tier) throw Error("Membership checkout ownership mismatch.");
      await ctx.db.patch(checkout._id, { state: "complete", subscriptionId: a.subscriptionId });
      // Completing a trial consumes the offer even though its first invoice is £0.
      if (checkout.intro !== "none") await ctx.db.patch(a.accountId, { membershipIntroUsed: true, membershipIntroChoice: checkout.intro });
    }
    await ctx.db.patch(a.accountId, {
      membershipSubscriptionCreatedAt: a.subscriptionCreatedAt,
      stripeSubscriptionId: a.subscriptionId, membershipTier: a.tier,
      membershipStatus: a.status, membershipActive: ["active", "trialing"].includes(a.status),
      ...(a.paidThrough ? { membershipPaidThrough: a.paidThrough } : {}),
      membershipTrialEnd: a.trialEnd, membershipCancelAtPeriodEnd: a.cancelAtPeriodEnd,
      membershipSource: undefined,
      // A lifecycle event cannot manufacture paid entitlement. Only paid invoices extend it.
      ...(!["active", "trialing"].includes(a.status) ? { membershipPaidThrough: undefined } : {}),
    });
  },
});

/** Exactly one grant per paid invoice. Receipts containing rentals grant credit ONLY on the recurring membership line. */
export const grantPaidInvoice = internalMutation({
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), invoiceId: v.string(), paidMembershipPence: v.number(), periodEnd: v.number(), checkoutId:v.optional(v.id("membership_checkouts")) },
  handler: async (ctx, a) => {
    if (!Number.isSafeInteger(a.paidMembershipPence) || a.paidMembershipPence <= 0 || !Number.isSafeInteger(a.periodEnd)) throw Error("Invalid paid membership invoice.");
    const existing = await ctx.db.query("membership_credit_grants").withIndex("by_invoice", q => q.eq("invoiceId", a.invoiceId)).unique();
    if (existing) {
      if (existing.accountId !== a.accountId || existing.subscriptionId !== a.subscriptionId || existing.paidMembershipPence !== a.paidMembershipPence) throw Error("Membership invoice ownership mismatch.");
      return existing._id;
    }
    const account = await ctx.db.get(a.accountId);
    if (!account || account.stripeSubscriptionId !== a.subscriptionId) throw Error("Paid invoice subscription does not match the account.");
    const previous = await ctx.db.query("membership_credit_grants").withIndex("by_account", q => q.eq("accountId", a.accountId)).collect();
    const bonusPence = account.membershipIntroChoice === "credit" && !previous.some(r => r.bonusPence > 0) ? 2000 : 0;
    const earned = monthlyCreditPence(a.paidMembershipPence,account.membershipTier);
    const checkout = a.checkoutId ? await ctx.db.get(a.checkoutId) : null;
    if (a.checkoutId && (!checkout || checkout.accountId !== a.accountId || checkout.subscriptionId !== a.subscriptionId))
      throw Error("First-month credit checkout ownership mismatch.");
    if (checkout?.initialCreditInvoiceId && checkout.initialCreditInvoiceId !== a.invoiceId)
      throw Error("First-month credit is already settled by another invoice.");
    const reservedCredit = checkout?.initialCreditAppliedPence ?? 0;
    const booking = checkout?.bookingId ? await ctx.db.get(checkout.bookingId) : null;
    if (reservedCredit > 0 && (checkout?.intro !== "none" || !booking || booking.membershipCheckoutId !== checkout?._id ||
      Math.round((booking.membershipCreditApplied ?? 0)*100) !== reservedCredit || reservedCredit > earned))
      throw Error("First-month credit does not match the agreed rental payment.");
    const initialCreditAppliedPence = booking?.status === "cancelled" ? 0 : reservedCredit;
    // Preserve the credit promised in an open checkout if a refund creates a
    // debt meanwhile. Only unreserved credit can clear that future-credit offset.
    const debtUsed = Math.min(earned-initialCreditAppliedPence, account.membershipCreditDebtPence ?? 0);
    const creditPence = earned - debtUsed;
    const signupOffer = checkout?.membershipSignupOfferSaving ?? checkout?.starterOfferSaving ?? 0;
    if (signupOffer > 0) {
      const expectedSignup = checkout?.tier === "plus" ? (checkout.starterOfferSaving === 10 ? 10 : 5) : 10;
      const eligible = checkout?.tier === "plus" || checkout?.tier === "pro" || checkout?.tier === "studio";
      if (!eligible || checkout?.intro !== "none" || signupOffer !== expectedSignup || account.membershipSignupOfferUsed || account.starterRentalOfferUsed)
        throw Error("Membership welcome offer has already been used or does not match this checkout.");
      await ctx.db.patch(account._id,{membershipSignupOfferUsed:true});
    }
    if (debtUsed) await ctx.db.patch(account._id, {membershipCreditDebtPence: (account.membershipCreditDebtPence ?? 0) - debtUsed});
    const {checkoutId: _checkoutId, ...invoiceReceipt} = a;
    const id = await ctx.db.insert("membership_credit_grants", { ...invoiceReceipt, creditPence, earnedCreditPence:earned, initialCreditAppliedPence, bonusPence, revokedPence: 0, createdAt: Date.now() });
    const issue = (amount: number, reason: string, spent = 0) => ctx.db.insert("credits", {
      accountId: a.accountId, amount: amount / 100, remaining: (amount-spent) / 100, currency: "GBP", reason,
      createdAt: Date.now(), expiresAt: Date.now() + 365 * 86400000, status: amount === spent ? "spent" : "active",
      membershipInvoiceId: a.invoiceId, membershipGrantId: id,
    });
    const creditId = await issue(creditPence, "Paid membership · plan rental credit", initialCreditAppliedPence);
    const bonusCreditId = bonusPence ? await issue(bonusPence, "One-time membership welcome credit") : undefined;
    await ctx.db.patch(id, { creditId, bonusCreditId });
    if (checkout) await ctx.db.patch(checkout._id,{initialCreditInvoiceId:a.invoiceId});
    if (initialCreditAppliedPence > 0 && booking) await ctx.db.patch(booking._id,{membershipCreditGrantId:id});
    if (a.periodEnd > (account.membershipPaidThrough ?? 0)) await ctx.db.patch(a.accountId, { membershipPaidThrough: a.periodEnd });
    return id;
  },
});

export const deliveryAvailable = internalQuery({
  args: { accountId: v.id("accounts"), month: v.string(), prospective: v.optional(v.boolean()) },
  handler: async (ctx, { accountId, month, prospective }) => studioDeliveryAvailable(ctx, await ctx.db.get(accountId), month, prospective),
});

/** Unverified guest stub grants no session and no access to existing account balances. */
export const bootstrapCheckoutAccount = internalMutation({
 args:{email:v.string(),name:v.string(),seedHash:v.string()},
 handler:async(ctx,a)=>{
  const email=a.email.trim().toLowerCase();
  const existing=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email)).unique();
  if(existing){if(existing.checkoutSeedHash===a.seedHash&&!existing.hash&&!existing.googleId&&!existing.stripeSubscriptionId)return existing;throw Error("Sign in to your existing account before adding a membership.");}
  const id=await ctx.db.insert("accounts",{email,name:a.name,checkoutSeedHash:a.seedHash,emailVerificationRequired:true,createdAt:Date.now()});return (await ctx.db.get(id))!;
 }
});

export const byRequest = internalQuery({
 args:{requestId:v.string(),email:v.string()},
 handler:async(ctx,a)=>{const row=await ctx.db.query("membership_checkouts").withIndex("by_request",q=>q.eq("requestId",a.requestId)).unique();if(!row)return null;const account=await ctx.db.get(row.accountId);if(!account||account.email!==a.email.trim().toLowerCase())return null;return row;}
});
export const saveSessionParams = internalMutation({
 args:{id:v.id("membership_checkouts"),bookingId:v.id("bookings"),sessionParams:v.string()},
 handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row||row.state!=="creating")throw Error("Membership checkout is no longer being prepared.");if(row.sessionParams&&row.sessionParams!==a.sessionParams)throw Error("Membership checkout has already been prepared.");await ctx.db.patch(a.id,{bookingId:a.bookingId,sessionParams:a.sessionParams});}
});

export const revokeRefundedInvoice = internalMutation({
 args:{invoiceId:v.string(),membershipRefundedPence:v.number()},
 handler:async(ctx,a)=>{
  const grant=await ctx.db.query("membership_credit_grants").withIndex("by_invoice",q=>q.eq("invoiceId",a.invoiceId)).unique();if(!grant)return;
  if(!Number.isSafeInteger(a.membershipRefundedPence)||a.membershipRefundedPence<0)throw Error("Invalid membership refund.");
  const refunded=Math.min(grant.paidMembershipPence,a.membershipRefundedPence);
  if(refunded<=(grant.membershipRefundedPence??0))return;
  const target=Math.round((grant.earnedCreditPence??monthlyCreditPence(grant.paidMembershipPence))*refunded/grant.paidMembershipPence)+(refunded===grant.paidMembershipPence?grant.bonusPence:0);
  let need=Math.max(0,target-grant.revokedPence);
  const accountForReservation=await ctx.db.get(grant.accountId);
  const pending=accountForReservation?await ctx.db.query("bookings").withIndex("by_guestEmail",q=>q.eq("guestEmail",accountForReservation.email)).collect():[];
  const credits=await ctx.db.query("credits").withIndex("by_account",q=>q.eq("accountId",grant.accountId)).collect();
  let reserved=Math.max(0,pending.filter(b=>b.status==="pending_payment").reduce((n,b)=>n+Math.round(((b.creditApplied??0)-(b.membershipCreditApplied??0))*100),0)-credits.filter(c=>c.status==="active").reduce((n,c)=>n+(c.revokedPendingPence??0),0));
  // Cancellation can restore first-month credit into a new linked credit row.
  // Revoke that balance too; a returned rental must not turn it into free money.
  const grantCreditIds = new Set([grant.creditId,grant.bonusCreditId,...credits.filter(c=>c.membershipGrantId===grant._id).map(c=>c._id)]);
  for(const id of grantCreditIds){
    const c=id?await ctx.db.get(id):null;if(!c||!need)continue;
    const remaining=Math.round(c.remaining*100),alreadyFrozen=c.revokedPendingPence??0;
    const protect=Math.min(Math.max(0,remaining-alreadyFrozen),reserved);
    const take=Math.min(Math.max(0,remaining-alreadyFrozen-protect),need);need-=take;
    const freeze=Math.min(protect,need);need-=freeze;reserved-=freeze;
    await ctx.db.patch(c._id,{remaining:(remaining-take)/100,revokedPendingPence:alreadyFrozen+freeze,revokedAmount:(c.revokedAmount??0)+(take+freeze)/100,...(remaining===take&&c.status==="active"?{status:"spent"}:{})});
  }
  const account=await ctx.db.get(grant.accountId);
  if(account){await ctx.db.patch(account._id,{membershipCreditDebtPence:(account.membershipCreditDebtPence??0)+need,...(refunded===grant.paidMembershipPence&&account.membershipPaidThrough===grant.periodEnd?{membershipPaidThrough:undefined}:{})});}
  await ctx.db.patch(grant._id,{membershipRefundedPence:refunded,revokedPence:target});
 }
});
