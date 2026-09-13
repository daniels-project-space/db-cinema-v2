/** Await the destination route and its loaded catalogue, rather than a fixed paint delay. */
let latestRequest = 0;
export async function scrollToSelector(selector: string, route?: string, block: ScrollLogicalPosition = "center") {
  const canonicalRoute = (value: string) => {
    const url = new URL(value, window.location.origin);
    const query = url.searchParams.toString();
    return url.pathname + (query ? `?${query}` : "");
  };
  const request = ++latestRequest;
  const until = Date.now() + 8_000;
  while (request === latestRequest && Date.now() < until) {
    const current = canonicalRoute(window.location.href);
    const catalogue = document.querySelector<HTMLElement>("[data-gaffer-route]");
    const routeReady = !route || canonicalRoute(route) === current;
    const dataReady = window.location.pathname !== "/gear" ||
      (catalogue?.dataset.gafferReady === "true" && catalogue.dataset.gafferRoute === current);
    const el = document.querySelector<HTMLElement>(selector);
    if (routeReady && dataReady && el && el.getBoundingClientRect().height > 0) {
      el.scrollIntoView({ behavior: "instant", block });
      // Next's route scroll restoration and layout effects must also have settled.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (request !== latestRequest) return false;
      el.scrollIntoView({ behavior: "instant", block });
      return true;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}
