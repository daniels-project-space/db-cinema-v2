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
    l = rows.filter(l=>l.pricing && !l.displayOnly).sort((a,b)=>b.pricing.daily-a.pricing.daily)[0];
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
      try {
        if (await c.evaluate(expr)) return;
      } catch (e) {
        // A reload replaces Chrome's execution context. Retry only read-only
        // readiness checks; never suppress a failed assertion or browser action.
        if (
          !/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(
            e.message,
          )
        )
          throw e;
      }
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
  const potential = base.recommendations[0]?.netSaving ?? 0;
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('[data-testid="potential-membership-savings"]')`,
    ),
    Math.round(potential * 100) > 0,
    "Potential savings display must reflect positive net savings",
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
      `document.querySelector('aside[aria-hidden="false"]').innerText.includes('Delivery and refundable security are calculated at checkout.')&&!document.querySelector('aside[aria-hidden="false"]').innerText.includes('Separate card hold · not charged')`,
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
  assert(paid.depositAmount > 0, "first checkout retains upfront security");
  assert.equal(paid.deliveryReduction,0);
  assert.equal(paid.weekendSaving,0);
  const paidDue = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Math.round((paid.combinedTotalDue-paid.depositAmount)*100)/100);
  await until(
    `document.querySelector('[data-testid="basket-due"]').textContent===${JSON.stringify(paidDue)}`,
  );
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('[data-testid="applied-membership-savings"]')`,
    ),
    Math.round(
      paid.membershipNetSaving * 100,
    ) > 0,
    "Applied card requires positive net savings after the first fee",
  );
  assert.equal(
    await c.evaluate(
      `document.querySelector('[data-testid="basket-due"]').textContent`,
    ),
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(Math.round((paid.combinedTotalDue-paid.depositAmount)*100)/100),
  );
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.innerText==='See the subscription benefits').click()`,
  );
  await until(
    `!!document.querySelector('[role="dialog"][aria-label="Subscription benefits"]')`,
  );
  let modal = await c.evaluate(
    `(()=>{let d=document.querySelector('[role="dialog"][aria-label="Subscription benefits"]'),r=d.getBoundingClientRect();return {outsideCard:!d.closest('[data-testid="membership-upsell"]'),onScreen:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})()`,
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
    `!document.querySelector('[role="dialog"][aria-label="Subscription benefits"]')`,
  );
  // Real client navigation carries the one-click selection without a fresh consent claim.
  await c.evaluate(
    `setTimeout(()=>[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Secure checkout')).click(),0);true`,
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
  await until(
    `document.querySelector('[data-testid="membership-upsell"]').innerText.includes('This first rental still requires verification')`,
  );
  await until(`document.querySelector('[data-testid="checkout-due"]')?.textContent===${JSON.stringify(new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(paid.combinedTotalDue))}`);
  assert.equal(await c.evaluate(`(()=>{const s=document.querySelector('[data-testid="checkout-summary"]'),secondary=s.querySelector('[data-testid="checkout-secondary-charges"]');const rows=[...secondary.children].filter(e=>e.querySelector('.font-mono'));return rows.length===3&&rows.every(e=>getComputedStyle(e).fontSize==='11px')&&[...s.querySelectorAll('div')].some(e=>e.children.length===2&&e.firstElementChild.textContent==='Subscription credit applied'&&e.classList.contains('text-emerald-300'))})()`),true,"Checkout separates small subscription/security rows and green applied credit while retaining the full payment total");
  await c.evaluate(`document.querySelector('[data-testid="checkout-summary"]').scrollIntoView({block:'center'})`);
  await shot("checkout-summary-mobile");
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
    `document.querySelector('[data-testid="membership-upsell"]').innerText.includes('recommended for')`,
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
  // A large weekday kit must now offer first-month credit in this checkout.
  const weekdayStart = start + 3 * 86400000,
    weekdayEnd = weekdayStart;
  const bigWeekdayArgs = {...args,items:args.items.map(i=>({...i,start:weekdayStart,end:weekdayEnd}))};
  const bigWeekdayQuote = await cv.action(api.checkout.priceQuote,bigWeekdayArgs);
  assert.equal(bigWeekdayQuote.recommendations[0].tier,"studio");
  assert.equal(bigWeekdayQuote.recommendations[0].intro,"none");
  assert(bigWeekdayQuote.recommendations[0].membershipCreditApplied > 0);
  const bigWeekdayItem = {...item,key:l._id+":big-weekday",start:new Date(weekdayStart).toISOString().slice(0,10),end:new Date(weekdayEnd).toISOString().slice(0,10),days:1,total:bigWeekdayQuote.items[0].total,perDay:bigWeekdayQuote.items[0].total};
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([bigWeekdayItem]))});localStorage.removeItem('dbc_membership_selection_v1');true`);
  await c.cmd("Page.navigate", {url:root+"/cart"});
  await until(`!!document.querySelector('[data-testid="potential-membership-savings"]')`);
  assert((await c.evaluate(`document.querySelector('[data-testid="potential-membership-savings"]').innerText`)).includes(bigWeekdayQuote.recommendations[0].netSaving.toFixed(2)));
  await shot("weekday-immediate-credit-mobile");
  // Below £100 there must be no unsolicited subscription offer.
  const cheap = rows.filter(l=>l.pricing && !l.displayOnly && l.pricing.daily<30).sort((a,b)=>a.pricing.daily-b.pricing.daily)[0];
  assert(cheap,"Need a small kit for the no-saving regression");
  const weekdayArgs = {...args,items:args.items.map(i=>({...i,listingId:cheap._id,title:cheap.title,start:weekdayStart,end:weekdayEnd}))};
  const weekdayQuote = await cv.action(api.checkout.priceQuote, weekdayArgs);
  assert(
    weekdayQuote.recommendations.every((r) => r.netSaving <= 0),
    "Fixture must have no net saving",
  );
  const weekdayItem = {
    ...item,
    listingId:cheap._id,title:cheap.title,slug:cheap.slug,heroImage:cheap.heroImage,days:1,
    key: cheap._id + ":weekday",
    start: new Date(weekdayStart).toISOString().slice(0, 10),
    end: new Date(weekdayEnd).toISOString().slice(0, 10),
    total: weekdayQuote.items[0].total,
    perDay: weekdayQuote.items[0].total,
  };
  await c.evaluate(
    `localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([weekdayItem]))});localStorage.removeItem('dbc_membership_selection_v1');true`,
  );
  await c.cmd("Page.navigate", { url: root + "/cart" });
  await until(
    `!!document.querySelector('[data-testid="basket-due"]')&&document.querySelector('[data-testid="basket-due"]').textContent.includes('£')`,
  );
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('[data-testid="potential-membership-savings"]')`,
    ),
    false,
    "Zero saving must hide the discount panel",
  );
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('[data-testid="membership-upsell"]')`,
    ),
    false,
    "Do not upsell a membership when this order has no net saving",
  );
  // A plan already chosen on an earlier basket remains visible/manageable
  // when the renter changes to dates without a discount. This is a persisted
  // checkout preference, not an active subscription or stored legal consent.
  await c.evaluate(
    `localStorage.setItem('dbc_membership_selection_v1',JSON.stringify({tier:'pro',intro:'none'}));true`,
  );
  await reload();
  const noSavingPaid = await cv.action(api.checkout.priceQuote, {
    ...weekdayArgs,
    selectedMembership: { tier: "pro", intro: "none" },
  });
  assert(
    noSavingPaid.membershipNetSaving <
      0,
  );
  const noSavingDue = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Math.round((noSavingPaid.combinedTotalDue-noSavingPaid.depositAmount)*100)/100);
  await until(
    `document.querySelector('[data-testid="basket-due"]').textContent===${JSON.stringify(noSavingDue)}`,
  );
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('[data-testid="applied-membership-savings"]')`,
    ),
    false,
    "Fee exceeding savings must hide the discount panel",
  );
  assert.equal(
    await c.evaluate(
      `!![...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership')`,
    ),
    true,
    "Selected plan remains manageable",
  );
  await shot("no-savings-mobile");
  // Edit one of two independently dated copies of a listing. Other lines must
  // survive, and the stored base price must come from the real pricing action.
  const secondStart=weekdayStart+30*86400000;
  const secondItem={...weekdayItem,key:cheap._id+":second-dates",start:new Date(secondStart).toISOString().slice(0,10),end:new Date(secondStart).toISOString().slice(0,10)};
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([weekdayItem,secondItem]))});localStorage.removeItem('dbc_membership_selection_v1');true`);
  await c.cmd("Page.navigate",{url:root+"/cart"});
  await until(`document.querySelectorAll('main [data-cart-dates]').length===2&&document.querySelector('[data-testid="basket-due"]')?.textContent.includes('£')`);
  assert.equal(await c.evaluate(`(()=>{const s=document.querySelector('[data-testid="basket-summary"]');return !s.innerText.includes('Refundable security payment (50%)')&&!s.innerText.includes('Separate card hold')})()`),true);
  await c.evaluate(`document.querySelector('main [data-cart-dates] button').click()`);
  const newEnd=new Date(weekdayStart+2*86400000).toISOString().slice(0,10);
  async function dateInput(index,value){await c.evaluate(`(()=>{const e=document.querySelectorAll('main [data-cart-dates] input')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  await dateInput(1,new Date(weekdayStart-86400000).toISOString().slice(0,10));
  assert.equal(await c.evaluate(`document.querySelector('main [data-cart-dates] button:last-child').disabled`),true,"Reversed dates must not save");
  await dateInput(1,newEnd);
  await until(`!document.querySelector('main [data-cart-dates] button:last-child').disabled`);
  for(const width of [1440,390]){
    await c.cmd("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await c.evaluate(`document.querySelector('main [data-cart-dates]').scrollIntoView({block:'center'})`);await wait(300);
    assert.equal(await c.evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    await shot("date-editor-"+width);
  }
  await c.evaluate(`document.querySelector('main [data-cart-dates] button:last-child').click()`);
  await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].end===${JSON.stringify(newEnd)}&&!document.querySelector('main [data-cart-dates] input')`);
  const stored=await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1'))`);
  assert.equal(stored[0].days,3);assert.deepEqual(stored[1],secondItem,"Changing the first line must preserve the second line");
  const editedQuote=await cv.action(api.checkout.priceQuote,{...weekdayArgs,items:[{...weekdayArgs.items[0],end:weekdayStart+2*86400000}, {...weekdayArgs.items[0],start:secondStart,end:secondStart}]});
  assert.equal(stored[0].total,editedQuote.items[0].total,"Saved line price must reflect the authoritative new date quote");
  const editedDue=new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(Math.round((editedQuote.combinedTotalDue-editedQuote.depositAmount)*100)/100);
  await until(`document.querySelector('[data-testid="basket-due"]').textContent===${JSON.stringify(editedDue)}`);
  await reload();
  await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].end===${JSON.stringify(newEnd)}&&document.querySelectorAll('main [data-cart-dates]').length===2`);
  await c.evaluate(`document.querySelector('button[aria-label="Open kit"]').click()`);
  await until(`document.querySelectorAll('aside[aria-hidden="false"] [data-cart-dates]').length===2`);
  assert.equal(await c.evaluate(`document.querySelector('aside[aria-hidden="false"] [data-cart-dates]').textContent.includes('Change dates')`),true);
  await until(`!document.querySelector('aside[aria-hidden="false"]').textContent.includes('Calculating…')`);
  await wait(700);
  await c.evaluate(`document.querySelector('aside[aria-hidden="false"] [data-cart-dates] button').click()`);
  await until(`document.querySelector('aside[aria-hidden="false"] [data-cart-dates]').textContent.includes('available with your kit')`);
  await wait(300);
  await shot("date-drawer-mobile");
  console.log({
    root,
    individualDatesPersistAndReprice:true,
    basketExcludesSecurity:true,
    checkoutFullTotalAndSecondaryCharges:true,
    guestOfferVisibleBeforeContact: true,
    oneClickCarry: true,
    reloadConsentReset: true,
    paidBasketMatchesAPI: true,
    zeroAndNegativeSavingsHidden: true,
    largeWeekdayImmediateCredit: true,
    modal,
    placement,
    screenshots: "/tmp/dbc-basket-*.png",
  });
  c.close();
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
