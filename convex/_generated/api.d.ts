/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountAccess from "../accountAccess.js";
import type * as accountAdmin from "../accountAdmin.js";
import type * as accountClaims from "../accountClaims.js";
import type * as accounts from "../accounts.js";
import type * as adminAuth from "../adminAuth.js";
import type * as adminNotifications from "../adminNotifications.js";
import type * as adminPushDelivery from "../adminPushDelivery.js";
import type * as admin_republish from "../admin_republish.js";
import type * as analytics from "../analytics.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as catalog from "../catalog.js";
import type * as changes from "../changes.js";
import type * as changes_node from "../changes_node.js";
import type * as chat from "../chat.js";
import type * as checkout from "../checkout.js";
import type * as checkoutRecovery from "../checkoutRecovery.js";
import type * as checkoutRecoveryMail from "../checkoutRecoveryMail.js";
import type * as collective from "../collective.js";
import type * as contact from "../contact.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as delivery from "../delivery.js";
import type * as didit from "../didit.js";
import type * as filmFund from "../filmFund.js";
import type * as filmFundAnnouncements from "../filmFundAnnouncements.js";
import type * as filmFundEntries from "../filmFundEntries.js";
import type * as filmFundMedia from "../filmFundMedia.js";
import type * as filmFundNotifications from "../filmFundNotifications.js";
import type * as filmFundPayments from "../filmFundPayments.js";
import type * as followUp from "../followUp.js";
import type * as gaffer from "../gaffer.js";
import type * as googleAuth from "../googleAuth.js";
import type * as holdRenewal from "../holdRenewal.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as invoice from "../invoice.js";
import type * as kitPlans from "../kitPlans.js";
import type * as lateFees from "../lateFees.js";
import type * as lib_adminPush from "../lib/adminPush.js";
import type * as lib_botModel from "../lib/botModel.js";
import type * as lib_catalogImages from "../lib/catalogImages.js";
import type * as lib_checkoutCredit from "../lib/checkoutCredit.js";
import type * as lib_checkoutRecovery from "../lib/checkoutRecovery.js";
import type * as lib_creditLedger from "../lib/creditLedger.js";
import type * as lib_diditCapacity from "../lib/diditCapacity.js";
import type * as lib_gafferDiscount from "../lib/gafferDiscount.js";
import type * as lib_kitPlanning from "../lib/kitPlanning.js";
import type * as lib_lateFee from "../lib/lateFee.js";
import type * as lib_loyalty from "../lib/loyalty.js";
import type * as lib_mailer from "../lib/mailer.js";
import type * as lib_memberDelivery from "../lib/memberDelivery.js";
import type * as lib_membership from "../lib/membership.js";
import type * as lib_membershipBilling from "../lib/membershipBilling.js";
import type * as lib_mount from "../lib/mount.js";
import type * as lib_mp4Duration from "../lib/mp4Duration.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_referrals from "../lib/referrals.js";
import type * as lib_rentalBillingLines from "../lib/rentalBillingLines.js";
import type * as lib_rentalChat from "../lib/rentalChat.js";
import type * as lib_rentalCreditPolicy from "../lib/rentalCreditPolicy.js";
import type * as lib_rentalInventory from "../lib/rentalInventory.js";
import type * as lib_rentalPaymentPlan from "../lib/rentalPaymentPlan.js";
import type * as lib_rentalPaymentSources from "../lib/rentalPaymentSources.js";
import type * as lib_rentalPrice from "../lib/rentalPrice.js";
import type * as lib_rentalRefundBalance from "../lib/rentalRefundBalance.js";
import type * as lib_rentalReplyTemplates from "../lib/rentalReplyTemplates.js";
import type * as lib_repeatRental from "../lib/repeatRental.js";
import type * as lib_repeatRentalProvider from "../lib/repeatRentalProvider.js";
import type * as lib_reviewContext from "../lib/reviewContext.js";
import type * as lib_reviewEligibility from "../lib/reviewEligibility.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as lib_verificationReuse from "../lib/verificationReuse.js";
import type * as membershipBenefits from "../membershipBenefits.js";
import type * as notify from "../notify.js";
import type * as offers from "../offers.js";
import type * as operators from "../operators.js";
import type * as promo from "../promo.js";
import type * as rateLimit from "../rateLimit.js";
import type * as recommendations from "../recommendations.js";
import type * as referralCampaigns from "../referralCampaigns.js";
import type * as referralMail from "../referralMail.js";
import type * as referralPayments from "../referralPayments.js";
import type * as referrals from "../referrals.js";
import type * as rentalAdditionState from "../rentalAdditionState.js";
import type * as rentalAdditions from "../rentalAdditions.js";
import type * as rentalChat from "../rentalChat.js";
import type * as rentalContents from "../rentalContents.js";
import type * as rentalCreditOffers from "../rentalCreditOffers.js";
import type * as rentalOperations from "../rentalOperations.js";
import type * as rentalRequests from "../rentalRequests.js";
import type * as repeatRentals from "../repeatRentals.js";
import type * as reviewActions from "../reviewActions.js";
import type * as reviewFollowUp from "../reviewFollowUp.js";
import type * as reviewFollowUpState from "../reviewFollowUpState.js";
import type * as reviewInvitations from "../reviewInvitations.js";
import type * as reviewPrize from "../reviewPrize.js";
import type * as reviewPrizeMail from "../reviewPrizeMail.js";
import type * as reviews from "../reviews.js";
import type * as rmv2_sync from "../rmv2_sync.js";
import type * as rmv2_webhook from "../rmv2_webhook.js";
import type * as settings from "../settings.js";
import type * as swml from "../swml.js";
import type * as sync from "../sync.js";
import type * as voice from "../voice.js";
import type * as voiceCatalog from "../voiceCatalog.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountAccess: typeof accountAccess;
  accountAdmin: typeof accountAdmin;
  accountClaims: typeof accountClaims;
  accounts: typeof accounts;
  adminAuth: typeof adminAuth;
  adminNotifications: typeof adminNotifications;
  adminPushDelivery: typeof adminPushDelivery;
  admin_republish: typeof admin_republish;
  analytics: typeof analytics;
  availability: typeof availability;
  bookings: typeof bookings;
  catalog: typeof catalog;
  changes: typeof changes;
  changes_node: typeof changes_node;
  chat: typeof chat;
  checkout: typeof checkout;
  checkoutRecovery: typeof checkoutRecovery;
  checkoutRecoveryMail: typeof checkoutRecoveryMail;
  collective: typeof collective;
  contact: typeof contact;
  credits: typeof credits;
  crons: typeof crons;
  delivery: typeof delivery;
  didit: typeof didit;
  filmFund: typeof filmFund;
  filmFundAnnouncements: typeof filmFundAnnouncements;
  filmFundEntries: typeof filmFundEntries;
  filmFundMedia: typeof filmFundMedia;
  filmFundNotifications: typeof filmFundNotifications;
  filmFundPayments: typeof filmFundPayments;
  followUp: typeof followUp;
  gaffer: typeof gaffer;
  googleAuth: typeof googleAuth;
  holdRenewal: typeof holdRenewal;
  http: typeof http;
  identity: typeof identity;
  invoice: typeof invoice;
  kitPlans: typeof kitPlans;
  lateFees: typeof lateFees;
  "lib/adminPush": typeof lib_adminPush;
  "lib/botModel": typeof lib_botModel;
  "lib/catalogImages": typeof lib_catalogImages;
  "lib/checkoutCredit": typeof lib_checkoutCredit;
  "lib/checkoutRecovery": typeof lib_checkoutRecovery;
  "lib/creditLedger": typeof lib_creditLedger;
  "lib/diditCapacity": typeof lib_diditCapacity;
  "lib/gafferDiscount": typeof lib_gafferDiscount;
  "lib/kitPlanning": typeof lib_kitPlanning;
  "lib/lateFee": typeof lib_lateFee;
  "lib/loyalty": typeof lib_loyalty;
  "lib/mailer": typeof lib_mailer;
  "lib/memberDelivery": typeof lib_memberDelivery;
  "lib/membership": typeof lib_membership;
  "lib/membershipBilling": typeof lib_membershipBilling;
  "lib/mount": typeof lib_mount;
  "lib/mp4Duration": typeof lib_mp4Duration;
  "lib/pricing": typeof lib_pricing;
  "lib/referrals": typeof lib_referrals;
  "lib/rentalBillingLines": typeof lib_rentalBillingLines;
  "lib/rentalChat": typeof lib_rentalChat;
  "lib/rentalCreditPolicy": typeof lib_rentalCreditPolicy;
  "lib/rentalInventory": typeof lib_rentalInventory;
  "lib/rentalPaymentPlan": typeof lib_rentalPaymentPlan;
  "lib/rentalPaymentSources": typeof lib_rentalPaymentSources;
  "lib/rentalPrice": typeof lib_rentalPrice;
  "lib/rentalRefundBalance": typeof lib_rentalRefundBalance;
  "lib/rentalReplyTemplates": typeof lib_rentalReplyTemplates;
  "lib/repeatRental": typeof lib_repeatRental;
  "lib/repeatRentalProvider": typeof lib_repeatRentalProvider;
  "lib/reviewContext": typeof lib_reviewContext;
  "lib/reviewEligibility": typeof lib_reviewEligibility;
  "lib/taxonomy": typeof lib_taxonomy;
  "lib/verificationReuse": typeof lib_verificationReuse;
  membershipBenefits: typeof membershipBenefits;
  notify: typeof notify;
  offers: typeof offers;
  operators: typeof operators;
  promo: typeof promo;
  rateLimit: typeof rateLimit;
  recommendations: typeof recommendations;
  referralCampaigns: typeof referralCampaigns;
  referralMail: typeof referralMail;
  referralPayments: typeof referralPayments;
  referrals: typeof referrals;
  rentalAdditionState: typeof rentalAdditionState;
  rentalAdditions: typeof rentalAdditions;
  rentalChat: typeof rentalChat;
  rentalContents: typeof rentalContents;
  rentalCreditOffers: typeof rentalCreditOffers;
  rentalOperations: typeof rentalOperations;
  rentalRequests: typeof rentalRequests;
  repeatRentals: typeof repeatRentals;
  reviewActions: typeof reviewActions;
  reviewFollowUp: typeof reviewFollowUp;
  reviewFollowUpState: typeof reviewFollowUpState;
  reviewInvitations: typeof reviewInvitations;
  reviewPrize: typeof reviewPrize;
  reviewPrizeMail: typeof reviewPrizeMail;
  reviews: typeof reviews;
  rmv2_sync: typeof rmv2_sync;
  rmv2_webhook: typeof rmv2_webhook;
  settings: typeof settings;
  swml: typeof swml;
  sync: typeof sync;
  voice: typeof voice;
  voiceCatalog: typeof voiceCatalog;
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
