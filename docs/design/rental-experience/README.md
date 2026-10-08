# Rental experience redesign

The complete scope and added dark-management/equipment-render requirements are tracked in [TODO.md](TODO.md).

Six concept renders created with the built-in GPT image-generation tool on 7 October 2026:

- `renter-panel.png`: renter dashboard, equipment cards and verification timeline.
- `admin-chat.png`: three-column rental inbox with booking controls and drone review.
- `admin-panel.png`: operational dashboard, channel-coloured calendar and revenue.
- `return-settlement.png`: return inspection, retained amount, case and settlement preview.
- `dark-invoices.png`: dark invoice list, selected invoice and payment/settlement panel.
- `dark-members.png`: dark customers/members list, account profile, rental and document history.

Additional dark-mode renders used the attached approved return layout as a reference: preserve sidebar and restrained hierarchy, matte charcoal #151515, panels #1e1e1e, warm white text, copper #b98b64 accents, no light panels, glows or glassmorphism. Invoice prompt requested account-linked invoice history, PDF download and separate deposit-refund/hold-release rows. Customers/members prompt requested profiles, search, tier and verification filters, rental/conversation history and document review. Both used the built-in GPT image tool. Generated membership names, benefits, taxes and financial figures remain illustrative, not authoritative.

Shared prompt: high-fidelity desktop product UI for DB Cinema Rentals; sophisticated editorial typography, matte graphite and warm ivory, muted copper DB Cinema Web accent, thin borders, disciplined spacing, equipment photography; no glows, glassmorphism or decorative AI motifs.

Screen prompts specified rental dates, receipt/security breakdown, kit photos and upcoming rentals; admin cancel/reschedule/discount/return controls and manual drone licence assessment; copper website versus blue Hygglo calendar/revenue; and item condition, custom retention, damage-case reason, invoice and renter email previews.

These are visual references. Generated names, currencies, legal statements and figures are not business requirements. In particular, uncaptured card holds must never be included in cash refunds. Implementations must read actual authorised account, booking, inventory and settlement data.

## Acceptance still required

- Rebuild renter and admin surfaces against these layouts and inspect desktop/mobile screenshots.
- Verify master inventory mapping and live ongoing/upcoming reservations against all 108 upstream inventory rows.
- Offer quantity-aware mixed replacement sets, horizontal cards and atomic add-all alongside individual additions.
- Verify website bookings, updates and returns propagate to Rental Manager notifications and calendar with exact times.
- Verify DB Cinema Web colour and equipment images on Rental Manager cards, calendar and all-time revenue chart.
- Complete return issue/case controls, itemised invoice and automatic renter correspondence, with safe financial execution.
- Test deployed drone upload/manual approval and handover rejection before approval.

The full integration goal remains active. The concept images and initial drone implementation do not establish completion.
