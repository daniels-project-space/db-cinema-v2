import { storedBookingAllocation } from "./bookingComponentAllocation";

export async function assertComponentReplacementExtensionPricing(ctx: any, booking: any) {
  for (const line of booking?.lineItems ?? []) {
    const allocation = await storedBookingAllocation(ctx, line, booking._id);
    if (allocation && !allocation.extensionAdjustmentPence)
      throw Error("This kit extension needs a team quote because its substituted component has no approved extension rate.");
  }
}
