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
import type * as analytics from "../analytics.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as catalog from "../catalog.js";
import type * as changes from "../changes.js";
import type * as changes_node from "../changes_node.js";
import type * as chat from "../chat.js";
import type * as checkout from "../checkout.js";
import type * as collective from "../collective.js";
import type * as contact from "../contact.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as delivery from "../delivery.js";
import type * as gaffer from "../gaffer.js";
import type * as googleAuth from "../googleAuth.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as invoice from "../invoice.js";
import type * as lib_membership from "../lib/membership.js";
import type * as lib_mount from "../lib/mount.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as notify from "../notify.js";
import type * as offers from "../offers.js";
import type * as operators from "../operators.js";
import type * as promo from "../promo.js";
import type * as rateLimit from "../rateLimit.js";
import type * as recommendations from "../recommendations.js";
import type * as reviews from "../reviews.js";
import type * as rmv2_sync from "../rmv2_sync.js";
import type * as settings from "../settings.js";
import type * as sync from "../sync.js";
import type * as voice from "../voice.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  analytics: typeof analytics;
  availability: typeof availability;
  bookings: typeof bookings;
  catalog: typeof catalog;
  changes: typeof changes;
  changes_node: typeof changes_node;
  chat: typeof chat;
  checkout: typeof checkout;
  collective: typeof collective;
  contact: typeof contact;
  credits: typeof credits;
  crons: typeof crons;
  delivery: typeof delivery;
  gaffer: typeof gaffer;
  googleAuth: typeof googleAuth;
  http: typeof http;
  identity: typeof identity;
  invoice: typeof invoice;
  "lib/membership": typeof lib_membership;
  "lib/mount": typeof lib_mount;
  "lib/pricing": typeof lib_pricing;
  "lib/taxonomy": typeof lib_taxonomy;
  notify: typeof notify;
  offers: typeof offers;
  operators: typeof operators;
  promo: typeof promo;
  rateLimit: typeof rateLimit;
  recommendations: typeof recommendations;
  reviews: typeof reviews;
  rmv2_sync: typeof rmv2_sync;
  settings: typeof settings;
  sync: typeof sync;
  voice: typeof voice;
  waitlist: typeof waitlist;
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
