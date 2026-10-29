const SITE = "https://dbcinemarentals.com";

/** The single customer-facing sign-off used by booking, Gaffer and support mail. */
export function brandedEmailHtml(html: string): string {
  const source = String(html ?? "");
  if (source.includes("data-dbc-email-footer")) return source;

  const footer = `<table data-dbc-email-footer="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:30px;border-top:1px solid #d9d2c8"><tr><td width="54" valign="middle" style="padding:18px 12px 4px 0"><a href="${SITE}" style="text-decoration:none"><img src="${SITE}/db-cinema-logo-512.png" width="48" height="48" alt="DB Cinema Rentals" style="display:block;width:48px;height:48px;border:0;border-radius:9px"></a></td><td valign="middle" style="padding:18px 0 4px;font-family:Arial,Helvetica,sans-serif;color:#49443d;font-size:13px;line-height:1.6"><strong style="color:#191817">The DB Cinema Rentals Team</strong><br><a href="${SITE}" style="color:#6b533f;text-decoration:underline">dbcinemarentals.com</a></td></tr></table>`;
  const bodyClose = source.search(/<\/body\s*>/i);
  if (bodyClose >= 0) return `${source.slice(0, bodyClose)}${footer}${source.slice(bodyClose)}`;
  const htmlClose = source.search(/<\/html\s*>/i);
  if (htmlClose >= 0) return `${source.slice(0, htmlClose)}${footer}${source.slice(htmlClose)}`;
  return `${source}${footer}`;
}
