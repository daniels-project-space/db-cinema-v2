/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as catalog from "../catalog.js";
import type * as checkout from "../checkout.js";
import type * as contact from "../contact.js";
import type * as crons from "../crons.js";
import type * as identity from "../identity.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as notify from "../notify.js";
import type * as offers from "../offers.js";
import type * as promo from "../promo.js";
import type * as recommendations from "../recommendations.js";
import type * as reviews from "../reviews.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  availability: typeof availability;
  bookings: typeof bookings;
  catalog: typeof catalog;
  checkout: typeof checkout;
  contact: typeof contact;
  crons: typeof crons;
  identity: typeof identity;
  "lib/pricing": typeof lib_pricing;
  "lib/taxonomy": typeof lib_taxonomy;
  notify: typeof notify;
  offers: typeof offers;
  promo: typeof promo;
  recommendations: typeof recommendations;
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
