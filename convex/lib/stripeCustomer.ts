import type Stripe from "stripe";
import { ConvexError } from "convex/values";

type BillingAccount = { _id: string; email: string; name?: string; stripeCustomerId?: string; stripeSubscriptionId?: string };

/** Customer IDs belong to the Stripe account/mode that created them. Recover
 * only a proven missing/deleted ID, never a permission or transient failure. */
export async function ensureCheckoutCustomer(
  stripe: Stripe,
  account: BillingAccount,
  bind: (customerId: string, expectedCustomerId: string | undefined) => Promise<unknown>,
): Promise<string> {
  const previous = account.stripeCustomerId;
  if (previous) {
    try {
      const customer = await stripe.customers.retrieve(previous);
      if (!customer.deleted) {
        if (customer.metadata?.dbcAccountId && customer.metadata.dbcAccountId !== String(account._id))
          throw new ConvexError({code:"BILLING_ACCOUNT_MISMATCH",message:"Your billing account needs review. Please contact DB Cinema Rentals before paying."});
        return customer.id;
      }
    } catch (error: any) {
      if (error instanceof ConvexError) throw error;
      if (!(error?.type === "StripeInvalidRequestError" && error?.code === "resource_missing" &&
            error?.statusCode === 404 && error?.param === "id"))
        throw new ConvexError({code:"BILLING_UNAVAILABLE",message:"We couldn't connect to your billing account. Please try again before paying."});
    }
  }
  // Never replace the customer under an existing subscription: preserve its
  // provider records and require reconciliation instead of creating two owners.
  if (account.stripeSubscriptionId)
    throw new ConvexError({code:"BILLING_ACCOUNT_REVIEW",message:"Your existing membership billing needs review. Please contact DB Cinema Rentals before paying."});
  const customer = await stripe.customers.create(
    {metadata:{dbcAccountId:String(account._id),application:"db-cinema-rentals"}},
    {idempotencyKey:`dbc-checkout-customer-${account._id}-${previous ?? "new"}`},
  );
  // Stable creation parameters keep parallel rental/membership starts and a
  // lost response retry idempotent, even if the renter edits contact details.
  await stripe.customers.update(customer.id, {email:account.email,name:account.name});
  await bind(customer.id, previous);
  return customer.id;
}
