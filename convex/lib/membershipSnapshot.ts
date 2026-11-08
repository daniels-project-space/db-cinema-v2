export function membershipSnapshot(account: any): string {
  return JSON.stringify([account.stripeCustomerId ?? null, account.stripeSubscriptionId ?? null, account.membershipSubscriptionCreatedAt ?? null, account.membershipTier ?? null, account.membershipStatus ?? null, account.membershipActive ?? null, account.membershipPaidThrough ?? null, account.membershipTrialEnd ?? null, account.membershipCancelAtPeriodEnd ?? null, account.membershipSource ?? null]);
}
