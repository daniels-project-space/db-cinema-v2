# DB Cinema business Gmail connection

The site uses one OAuth connection for outbound mail and Gaffer's incoming-email workflow. OAuth tokens stay encrypted in Convex; server actions refresh them and call Gmail. The browser receives only a short-lived Google authorization URL. The connected account must be `info@dbcinemarentals.com`.

## Google Cloud setup

1. Select or create the Google Cloud project that will own DB Cinema's OAuth app. [Open the Gmail API page](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and enable it. Follow Google's [OAuth consent screen setup](https://developers.google.com/workspace/guides/configure-oauth-consent) to configure the Google Auth Platform.
2. Create an OAuth client with application type **Web application** using Google's [web application credentials guide](https://developers.google.com/workspace/guides/create-credentials). Add `https://dbcinemarentals.com` as an authorized JavaScript origin and `https://dbcinemarentals.com/api/admin/gmail/callback` as an authorized redirect URI. The redirect URI must match exactly.
3. Add the business account as a test user while the app is in testing. The site requests `openid`, `email`, and `https://www.googleapis.com/auth/gmail.modify`; this enables reading new incoming messages, sending mail, and preserving Gmail threading.
4. Add these server environment variables in Vercel and Convex. Use the same values in both systems for the client ID, client secret, and encryption key:

   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GMAIL_TOKEN_ENCRYPTION_KEY` — generate a 32-byte key, encoded as base64 (for example, `openssl rand -base64 32`)
   - `GOOGLE_OAUTH_REDIRECT_URI=https://dbcinemarentals.com/api/admin/gmail/callback` (Vercel)
   - `INBOUND_EMAIL_SECRET` (the same existing secret in Vercel and Convex)
   - `APP_URL=https://dbcinemarentals.com` (Convex, used by the Gmail sync worker)
   - `OWNER_EMAIL=info@dbcinemarentals.com` (Convex, if this variable is already set)

   Keep the OAuth client secret, encryption key, and inbound secret in server-only environments. Do not use `NEXT_PUBLIC_` names for them or paste their values into chat.

## Connect the mailbox

Before connecting, make sure `bookings@dbcinemarentals.com` and `gaffer+…@dbcinemarentals.com` are routed into the connected Gmail inbox. Use the existing Google Workspace alias or your domain mail-forwarding service; OAuth cannot read mail that is still delivered only to Resend or another mailbox. Test one customer reply through that route before disabling the old inbound webhook.

After the code and environment are deployed, open the admin **Messages → Emails** view, choose **Connect Gmail**, sign in as `info@dbcinemarentals.com`, and grant the requested access. The callback verifies the Google identity before it stores the encrypted refresh token. A Convex schedule checks Gmail history once a minute; each new message goes through the existing Gaffer dedupe, reply, and human-handoff path. Site email and AI-generated replies send from the connected Gmail account. When Gaffer asks for a human, the existing escalation sends the customer message to the owner inbox and copies the owner on the reply.

The initial history checkpoint is captured at consent, so old mail is not automatically replied to. Only messages received after connection are sent through Gaffer.

## Google verification

`gmail.modify` is a restricted Google OAuth scope. Before a public production OAuth app can use it broadly, Google may require app verification. Because this website stores message content in its backend and uses that content to produce replies, Google can also require a third-party security assessment for production verification. See Google's [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes) and [restricted-scope verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Testing-mode consent is not a substitute for production approval.

After Gmail sends are qualified, remove the old `GMAIL_APP_PASSWORD` setting and disable the old Resend inbound webhook. Resend is no longer an outbound fallback; the remaining Resend status lookup only supports already-recorded legacy deliveries.
