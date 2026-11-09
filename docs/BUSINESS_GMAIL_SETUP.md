# Business email routing

The business Gmail account connected in ChatGPT is a separate authorization. Its Gmail token cannot be read by the website's Convex backend. The website now sends admin and Gaffer replies through its existing Resend sender on the verified `dbcinemarentals.com` domain and uses `dbcinemarentals@gmail.com` as the reply address where appropriate. This avoids storing a personal Gmail password or treating the ChatGPT connector as a website credential.

Incoming website email is handled by the signed Resend `email.received` webhook. The Admin → Messages → Emails panel shows the configured Resend receiving address. To bring messages sent directly to Gmail into Gaffer, add that address under Gmail ⚙️ Settings → See all settings → Forwarding and POP/IMAP. Google sends its verification link to the Resend receiving address; open that message in the site email inbox, then return to Gmail, select “Forward a copy,” keep Gmail's copy in the inbox, and save. The site stores this specific Google verification email for the admin and does not send it to Gaffer. Do not use `INBOUND_EMAIL_DOMAIN`, which is not the configured receiving MX route. The Gmail connector can read and send individual emails, but it cannot configure Gmail forwarding for the website.

## Production configuration

The production Convex backend needs `RESEND_API_KEY`, `RESEND_FROM` using a `@dbcinemarentals.com` sender, `INBOUND_REPLY_ADDRESS`, and `INBOUND_EMAIL_SECRET`. Keep them in Convex production environment variables. The Vercel public Google sign-in client ID and the Gmail connection in ChatGPT do not grant backend mail access. A Gmail SMTP app password is no longer required for website replies.

## Verify the flow after deployment

1. In Admin → Messages → Emails, check that outbound replies show as ready and copy the inbound address.
2. In business Gmail, add that address as a forward destination and confirm Google's verification link from the site email inbox.
3. Select “Forward a copy,” keep Gmail's copy, and save the setting.
4. Send a test email to the business Gmail from another mailbox and confirm it reaches the Admin email inbox and Gaffer's conversation list.
5. Reply from Admin and confirm the email arrives with the configured DB Cinema sender and the business Gmail reply address.
6. Reply to that message from the test account and confirm Gmail forwarding returns it to the existing site thread.

Direct Gmail mailbox access from the website would require its own Google OAuth client, callback configuration, backend client secret, and a separate user consent flow. Do not copy the ChatGPT connector token into Convex or the website.
