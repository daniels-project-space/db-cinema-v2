/** Reserved session namespace used by all browser event callers. No user data. */
export const EXCLUDED_ANALYTICS_PREFIX = "excluded:";

export function isExcludedAnalyticsEvent(event: { sessionId?: string; path?: string }): boolean {
  return !!event.sessionId?.startsWith(EXCLUDED_ANALYTICS_PREFIX) || /^\/admin(?:\/|$)/.test(event.path ?? "");
}

/** Positive automation signals only: ordinary browsers remain counted. */
export function isAutomatedBrowser(userAgent: string, webdriver: boolean): boolean {
  return webdriver || /bot\b|crawler|spider|headlesschrome|phantomjs|lighthouse|pagespeed|facebookexternalhit|slurp|bingpreview|curl\/|wget\/|python-requests|playwright|puppeteer|selenium|uptimerobot|pingdom|monitoring/i.test(userAgent);
}
