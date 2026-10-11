# Quick Reply renter clock

Paired Rental Manager branch: `rebuild/quick-reply-reference-mobile`.

Owner-only `rentalChat:adminInbox` now exposes `lastRenterAt` using the new `messages.by_booking_account_sender_at` index. One descending point read binds booking, canonical account and sender=renter. Existing adminInbox caps remain 200 booking candidates/100 active conversations. Source messages and bookings are never changed by this read. The timestamp remains correct beyond the bounded 40-message search preview; owner, bot, system and foreign-account activity cannot advance it. A request without renter messages uses its stable creation time.

The actual-handler synthetic test covers denied access, stable creation fallback, renter follow-ups behind 75 non-renter messages, a foreign same-booking message, updated thread activity, and new renter restoration. Reads are asserted to leave every database table unchanged. The new regression is included in normal `npm test`.

Local full tests and TypeScript passed. Release together with Rental Manager after its complete UI audit. No production deployment, renter message, rental/listing/payment change was performed during implementation or tests.
