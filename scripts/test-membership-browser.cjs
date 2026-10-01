const fs = require("fs"),
  assert = require("assert/strict");
async function connect(url, existingId) {
  const tab = existingId
    ? (
        await fetch(
          `${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/list`,
        ).then((r) => r.json())
      ).find((t) => t.id === existingId)
    : await fetch(
        `${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/new?${encodeURIComponent(url ?? "about:blank")}`,
        { method: "PUT" },
      ).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl),
    pending = new Map(),
    listeners = new Set();
  let serial = 0;
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.reject(Error(m.error.message));
      else p?.resolve(m.result);
    } else for (const fn of listeners) fn(m);
  });
  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    cmd,
    on: (fn) => listeners.add(fn),
    evaluate: async (expression, extra = {}) =>
      (
        await cmd("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          ...extra,
        })
      ).result?.value,
    close: () => ws.close(),
    tabId: tab.id,
  };
}

const { ConvexHttpClient } = require("convex/browser"),
  { api } = require("../convex/_generated/api.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const root = process.env.DBC_BROWSER_ROOT || "http://127.0.0.1:41795",
    cv = new ConvexHttpClient(
      process.env.DBC_CONVEX_URL || "https://veracious-wombat-196.convex.cloud",
    );
  const r = await cv.query(api.catalog.listListings, {}),
    rows = Array.isArray(r) ? r : (r.items ?? r.listings ?? []),
    l = rows.find((l) => l.pricing && !l.displayOnly);
  const future = new Date(Date.now() + 60 * 86400000);
  const start =
      Date.UTC(
        future.getUTCFullYear(),
        future.getUTCMonth(),
        future.getUTCDate(),
      ) +
      ((5 - future.getUTCDay() + 7) % 7) * 86400000,
    end = start + 2 * 86400000;
  const startDate = new Date(start).toISOString().slice(0, 10),
    endDate = new Date(end).toISOString().slice(0, 10);
  const args = {
      items: [
        {
          listingId: l._id,
          title: l.title,
          start,
          end,
          qty: 1,
          total: 1,
          deposit: 1,
        },
      ],
      customerEmail: "",
      fulfilment: "pickup",
      protection: "verify",
    },
    base = await cv.action(api.checkout.priceQuote, args),
    item = {
      key: l._id + ":" + startDate + ":" + endDate,
      listingId: l._id,
      slug: l.slug,
      title: l.title,
      heroImage: l.heroImage,
      start: startDate,
      end: endDate,
      days: 3,
      perDay: base.items[0].total / 3,
      total: base.items[0].total,
      deposit: l.depositAmount,
    };
  const c = await connect();
  await c.cmd("Page.enable");
  await c.cmd("Network.enable");
  await c.cmd("Network.setCacheDisabled", { cacheDisabled: true });
  await c.cmd("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  async function until(expr) {
    for (let i = 0; i < 100; i++) {
      if (await c.evaluate(expr)) return;
      await wait(150);
    }
    throw Error("Browser condition timed out: " + expr);
  }
  async function reload() {
    const previous = await c.evaluate("performance.timeOrigin");
    await c.cmd("Page.reload");
    await until(
      `performance.timeOrigin!==${JSON.stringify(previous)}&&document.readyState==='complete'`,
    );
  }
  async function shot(name) {
    let s = await c.cmd("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      "/tmp/dbc-basket-" + name + ".png",
      Buffer.from(s.data, "base64"),
    );
  }
  await c.cmd("Page.navigate", { url: root + "/cart" });
  await wait(1500);
  await c.evaluate(
    `localStorage.clear();localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([item]))});true`,
  );
  await reload();
  await until(`!!document.querySelector('[data-testid="add-membership"]')`);
  await until(
    `document.querySelector('[data-testid="basket-due"]')?.textContent.includes('£')`,
  );
  for (const width of [1440, 390]) {
    await c.cmd("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await c.evaluate(
      `document.querySelector('[data-testid="membership-upsell"]').scrollIntoView({block:'center'})`,
    );
    await wait(300);
    assert.equal(
      await c.evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
    );
    await shot("offer-" + width);
  }
  await c.evaluate(
    `document.querySelector('[data-testid="add-membership"]').click()`,
  );
  await until(
    `!![...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership')`,
  );
  // The same one-click flow is also reachable from the header's slide-out basket.
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership').click()`,
  );
  await until(`!!document.querySelector('[data-testid="add-membership"]')`);
  await c.evaluate(
    `document.querySelector('button[aria-label="Open kit"]').click()`,
  );
  await until(
    `!!document.querySelector('aside[aria-hidden="false"] [data-testid="add-membership"]')`,
  );
  assert.equal(
    await c.evaluate(
      `document.querySelector('aside[aria-hidden="false"]').innerText.includes('Separate card hold · not charged')`,
    ),
    true,
  );
  await c.evaluate(
    `document.querySelector('aside[aria-hidden="false"] [data-testid="add-membership"]').click()`,
  );
  await until(
    `!![...document.querySelectorAll('aside[aria-hidden="false"] button')].find(b=>b.innerText==='Remove membership')`,
  );
  await shot("drawer-mobile");
  await c.evaluate(
    `document.querySelector('aside[aria-hidden="false"] button[aria-label="Close"]').click()`,
  );
  let preferred = await c.evaluate(
    `JSON.parse(localStorage.getItem('dbc_membership_selection_v1'))`,
  );
  assert(preferred?.tier);
  assert.equal(preferred.termsAccepted, undefined);
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.innerText==='Start paid membership now').click()`,
  );
  await until(
    `document.querySelector('[data-testid="basket-due"]')?.textContent.includes('£')`,
  );
  await wait(900);
  let paid = await cv.action(api.checkout.priceQuote, {
    ...args,
    selectedMembership: { tier: preferred.tier, intro: "none" },
  });
  assert.equal(paid.depositAmount, 0);
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="basket-due"]').textContent`,
    ),
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(paid.combinedTotalDue),
  );
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.innerText==='See the membership benefits').click()`,
  );
  await until(
    `!!document.querySelector('[role="dialog"][aria-label="Membership benefits"]')`,
  );
  let modal = await c.evaluate(
    `(()=>{let d=document.querySelector('[role="dialog"][aria-label="Membership benefits"]'),r=d.getBoundingClientRect();return {outsideCard:!d.closest('[data-testid="membership-upsell"]'),onScreen:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})()`,
  );
  assert(modal.outsideCard && modal.onScreen);
  await shot("benefits-mobile");
  await c.cmd("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(
    `!document.querySelector('[role="dialog"][aria-label="Membership benefits"]')`,
  );
  // Real client navigation carries the one-click selection without a fresh consent claim.
  await c.evaluate(
    `[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Secure checkout')).click()`,
  );
  await until(
    `location.pathname==='/checkout'&&!!document.querySelector('#co-email')&&!!document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]')`,
  );
  await until(
    `!![...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership')`,
  );
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]').checked`,
    ),
    false,
  );
  await wait(1000);
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="membership-upsell"]').innerText.includes('£0 upfront security')`,
    ),
    true,
  );
  await shot("selected-checkout-mobile");
  await reload();
  await until(
    `!!document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]')`,
  );
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]').checked`,
    ),
    false,
  );
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership').click()`,
  );
  await until(`!!document.querySelector('[data-testid="add-membership"]')`);
  await c.evaluate(
    `document.querySelector('[data-testid="membership-upsell"]').scrollIntoView({block:'center'})`,
  );
  await until(
    `document.querySelector('[data-testid="membership-upsell"]').innerText.includes('best fit')`,
  );
  await c.cmd("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await c.evaluate("window.scrollTo(0,0)");
  await wait(300);
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="add-membership"]').getBoundingClientRect().bottom<=innerHeight`,
    ),
    true,
    "Checkout membership CTA must be visible in the first mobile viewport",
  );
  await shot("checkout-offer-mobile");
  // The homepage placement is checked against the actual rendered sections.
  await c.cmd("Page.navigate", { url: root + "/" });
  await until(`!!document.querySelector('.fund-invite')`);
  let placement = await c.evaluate(
    `(()=>{let f=document.querySelector('.fund-invite');return {previousText:f.previousElementSibling?.innerText.slice(0,100),afterGear:!!f.previousElementSibling?.querySelector('a[href^="/gear"]')}})()`,
  );
  assert.equal(
    placement.afterGear,
    true,
    "Film Fund must remain directly after the gear catalogue",
  );
  console.log({
    root,
    guestOfferVisibleBeforeContact: true,
    oneClickCarry: true,
    reloadConsentReset: true,
    paidBasketMatchesAPI: true,
    modal,
    placement,
    screenshots: "/tmp/dbc-basket-*.png",
  });
  c.close();
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
