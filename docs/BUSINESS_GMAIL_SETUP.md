# Business email routing

The business Gmail account connected in ChatGPT is a separate authorization. Its Gmail token cannot be read by the website's Convex backend. The website sends admin and Gaffer replies through its existing Resend sender on the verified `dbcinemarentals.com` domain, with `dbcinemarentals@gmail.com` as the reply address. Customer replies then return to Gmail; confirmed Gmail forwarding sends them back through the signed Resend inbound webhook for Gaffer to continue the conversation. This avoids storing a Gmail password or treating the ChatGPT connector as a website credential.

Incoming website email is handled by the signed Resend `email.received` webhook. The Admin → Messages → Emails panel shows the configured Resend receiving address. To bring messages sent directly to Gmail into Gaffer, add that address under Gmail ⚙️ Settings → See all settings → Forwarding and POP/IMAP. Google sends its verification link to the Resend receiving address; open that message in the site email inbox, then return to Gmail, select “Forward a copy,” keep Gmail's copy in the inbox, and save. The site stores this specific Google verification email for the admin and does not send it to Gaffer. Do not use `INBOUND_EMAIL_DOMAIN`, which is not the configured receiving MX route. The Gmail connector can read and send individual emails, but it cannot configure Gmail forwarding for the website.

## Production configuration

Configure the inbound receiver in **both** production services:

- **Vercel:** `NEXT_PUBLIC_CONVEX_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `INBOUND_EMAIL_SECRET`.
- **Convex production:** `RESEND_API_KEY`, `RESEND_FROM` using a verified `@dbcinemarentals.com` sender, `INBOUND_REPLY_ADDRESS`, and the same `INBOUND_EMAIL_SECRET` value used by Vercel.

`RESEND_WEBHOOK_SECRET` authenticates Resend's signed `email.received` webhook at `/api/email/inbound`. `INBOUND_EMAIL_SECRET` authenticates the Vercel-to-Convex handoff; its value must match in both services. `RESEND_API_KEY` is needed in Vercel to retrieve the inbound message body and in Convex to send replies. Do not expose either secret with a `NEXT_PUBLIC_` name.

The Resend inbound domain also needs its receiving MX configuration and an `email.received` webhook pointing to the Vercel endpoint. The Gmail connection in ChatGPT does not grant backend mailbox access or configure Gmail forwarding. A Gmail SMTP app password is not required for website replies.

## Verify the flow after deployment

1. In Admin → Messages → Emails, check that outbound replies show as ready and copy the inbound address. This readiness check does not prove live DNS, webhook delivery, or Gmail forwarding.
2. In business Gmail, add that address as a forward destination and confirm Google's verification link from the site email inbox.
3. Select “Forward a copy,” keep Gmail's copy, and save the setting.
4. Send a test email to the business Gmail from another mailbox and confirm it reaches the Admin email inbox and Gaffer's conversation list.
5. Reply from Admin and confirm the email arrives with the configured DB Cinema sender and the business Gmail reply address.
6. Reply to that message from the test account and confirm Gmail forwarding returns it to the existing site thread.

Direct Gmail mailbox access from the website would require its own Google OAuth client, callback configuration, backend client secret, and a separate user consent flow. Do not copy the ChatGPT connector token into Convex or the website.
