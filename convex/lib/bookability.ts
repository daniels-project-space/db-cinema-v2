import { rentalUnavailable } from "./marketingInventory";

export const isPubliclyBookable = (listing: any) =>
  !!listing && !rentalUnavailable(listing) && Array.isArray(listing.components) && listing.components.length > 0 &&
  listing.components.every((component: any) => typeof component.inventoryUnitId === "string" && component.inventoryUnitId.length > 0 && Number.isSafeInteger(component.qty) && component.qty > 0);
