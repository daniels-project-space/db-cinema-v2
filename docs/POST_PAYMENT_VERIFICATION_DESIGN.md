# Post-payment verification

The GPT design reference uses the agreed dark management palette, copper actions, serif headings, a graphical verification journey, document cards, and a separate rental summary. It belongs to the renter account interface; the public landing, gear selection and checkout form keep their existing layout.

The finished design is in project R2 bucket `db-cinema-v2` at `design/post-payment-verification/2026-10-08/a5833b3f0310a214d20900daccd0d7518e77179c910a24a53ecf43c32999d1e0.png`. S3 HEAD and independent streamed GET verified 1,571,094 bytes and SHA256 `a5833b3f0310a214d20900daccd0d7518e77179c910a24a53ecf43c32999d1e0`. Owner receipt and design contract: `/root/CODEX_ARTIFACTS/db-cinema/post-payment-design-2026-10-08/`.

## Data and approval

The renter endpoint requires the canonical account or the exact paid Checkout session. It exposes actual booking periods, catalogue image alternatives, the rental price breakdown and security schedule. Internal equipment exposure/ceilings are not sent to renters; their backend enforcement remains in place.

Payment, document results, approval and pickup readiness are different states. Actual identity, selfie and address results drive the document cards. Approval requires the verified unexpired decision and a retained document archive. Pickup readiness additionally needs any required drone licence and current card security. Cancellation or return preparation closes uploads immediately without claiming that financial settlement has finished.

The existing signed Didit webhook and authenticated 15-second visible refresh supply progress. The verification action opens the real provider session. No generated UI bitmap replaces working controls or catalogue photos. Rental and chat links open the account's corresponding rental; account navigation supports its actual section hashes.

## Qualification status

This branch is a draft until actual staging desktop/mobile screenshots, flow checks and visual comparisons are completed. Unit/handler tests cover private account/session binding and denial, internal-field redaction, archive/expiry/security/drone readiness, and cancellation preparation. Production publication and checkout reopening are separate actions; checkout remains closed.
