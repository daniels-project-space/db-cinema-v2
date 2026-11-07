# Private chat scanner

The attachment feature remains disabled until the scanner is provisioned and independently qualified. Image structure checks and an antivirus result do not guarantee that files are safe. PDF attachments are not supported.

The private authenticated `GET /health` endpoint checks that the engine has signatures less than 48 hours old and detects the harmless EICAR test string. It returns no customer data. The checker in `scripts/check-chat-scanner-health.cjs` uses the existing `CHAT_ATTACHMENT_SCANNER_URL` and `CHAT_ATTACHMENT_SCANNER_TOKEN` environment variables; it requires HTTPS, verifies a fresh nonce and fails closed on errors. It does not enable attachments.

This is a point-in-time diagnostic, not an automated alert or a substitute for signature refresh. Production needs a separately provisioned updater, protected transport, recurring monitoring and operational response before the gate can be considered for release.
