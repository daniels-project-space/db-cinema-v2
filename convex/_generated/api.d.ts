/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as catalog from "../catalog.js";
import type * as checkout from "../checkout.js";
import type * as contact from "../contact.js";
import type * as crons from "../crons.js";
import type * as notify from "../notify.js";
import type * as reviews from "../reviews.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  availability: typeof availability;
  bookings: typeof bookings;
  catalog: typeof catalog;
  checkout: typeof checkout;
  contact: typeof contact;
  crons: typeof crons;
  notify: typeof notify;
  reviews: typeof reviews;
  sync: typeof sync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
