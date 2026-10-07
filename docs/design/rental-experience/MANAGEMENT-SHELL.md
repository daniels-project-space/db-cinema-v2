# Dark management workspace implementation

The authenticated admin and renter account pages use a shared dark sidebar shell with copper accents, a top bar, account identity and responsive navigation. CSS is scoped to that shell. Anonymous account access and admin sign-in retain their public header. Shared rental cards, kit images and admin conversation controls receive the management styles only inside the shell.

Sidebar navigation is connected to existing actions and real data. Admin Calendar uses the latest 100 authorised rental records, including pickup/return times; Invoices lists receipts and issued return settlements for the same records. Reports opens the existing analytics and demand tools. Customer Calendar and Invoices use the existing paginated account bookings, with a control to load older records. Unpaid requests are excluded from receipts; cancelled paid rentals retain their original receipts.

Invoice previews fetch the existing PDF route with a bearer sign-in credential, create a temporary local Blob URL, and revoke that URL when closed or the sign-in identity changes. Server invoice access supports the current admin credential and existing owning-account validation. Other renters and expired sessions remain denied. Legacy private receipt links and the server invoice key remain supported.

The security policy now explicitly allows Blob frames for authenticated document previews, also fixing admin verification-PDF viewing. Clickjacking protection and the ban on plugin/object embeds remain. PDF item and date columns have spacing to keep long listing names visually separate.

Evidence on 7 October 2026:

- TypeScript and production build passed. Rental agreement tests include admin invoice access, owning renter access, unrelated-account denial and expired-session denial, plus actual PDF rendering.
- Native Chromium, local application with actual development Convex records: admin Invoices and Calendar render; an existing paid cancelled rental opens as a visibly rendered PDF receipt. Direct HTTP checks returned 403 anonymously and 200/application-pdf with a `%PDF-` signature using admin bearer access.
- Desktop/mobile screenshots inspected. The mobile menu opens, navigation selects a section and closes the menu; document width stays 390px at a 390px viewport.
- Native checkout navigation retains its public header and contains no management shell.

These are development/local checks. Production publication, signed-in renter visual acceptance, the complete reference-screen rebuild, per-item return inspection and the full Rental Manager integration remain outstanding.
