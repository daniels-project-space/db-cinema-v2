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
      if (p) clearTimeout(p.timer);
      if (m.error) p?.reject(Error(m.error.message));
      else p?.resolve(m.result);
    } else for (const fn of listeners) fn(m);
  });
  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Browser command timed out: '+method+(method==='Runtime.evaluate'?' '+params.expression?.slice(0,240):'')));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
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
const { marketingRedirect } = require("./lib/rentalTestHarness.cjs").load("convex/lib/marketingInventory.ts");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const root = process.env.DBC_BROWSER_ROOT || "http://127.0.0.1:41795",
    cv = new ConvexHttpClient(
      process.env.DBC_CONVEX_URL || "https://veracious-wombat-196.convex.cloud",
    );
  const r = await cv.query(api.catalog.listListings, {}),
    rows = (Array.isArray(r) ? r : (r.items ?? r.listings ?? [])).filter(l => !(l.marketingOnly ?? !!marketingRedirect(l))),
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
  // This suite checks cart, pricing and persistence. Decorative video decoding
  // can strand Chrome's renderer during reload even after releaseMedia(); keep
  // real images, application scripts and backend traffic, but avoid that decoder.
  await c.cmd("Network.setBlockedURLs", { urls: ["*.mp4*", "*.webm*", "*.mov*"] });
  // Watch transient states too: the requested hook must stay exact through
  // selection, restored baskets and quote loading. No invented alternatives.
  await c.cmd("Page.addScriptToEvaluateOnNewDocument", {source: `
    new MutationObserver(() => {
      const heading = document.querySelector('[data-testid="membership-upsell"] h3, [data-testid="membership-upsell"] [data-testid="potential-membership-savings"]');
      if (heading && !/^Subscribe to save £\\d+\\.\\d{2}$/.test(heading.textContent.trim())) {
        window.__dbcMembershipHeadlineRegression = heading.textContent;
      }
    }).observe(document, {subtree:true, childList:true, characterData:true});
  `});
  await c.cmd("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  async function until(expr) {
    for (let i = 0; i < 100; i++) {
      try {
        if (await c.evaluate(expr)) {
          assert.equal(await c.evaluate('window.__dbcMembershipHeadlineRegression || null'),null,'Use exactly Subscribe to save £X in all card states');
          return;
        }
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
    // Release decorative media decoders before tearing down the document.
    // Cards and their animations are tested before this navigation step.
    await releaseMedia();
    await loadDocument("Page.reload");
    await until(
      `performance.timeOrigin!==${JSON.stringify(previous)}&&document.readyState!=='loading'`,
    );
  }
  async function navigate(url) {
    // CDP navigation acknowledges before the old document is replaced. Wait
    // for the new document so an old price panel cannot satisfy readiness.
    const previous = await c.evaluate("performance.timeOrigin");
    await releaseMedia();
    console.log({ navigation: new URL(url).pathname });
    await loadDocument("Page.navigate", { url });
    await until(
      `performance.timeOrigin!==${JSON.stringify(previous)}&&document.readyState!=='loading'`,
    );
  }
  async function releaseMedia() {
    // Pausing leaves decoder pipelines and media requests alive. Release them
    // after the rendered-state assertions, before Chrome tears down a page.
    await c.evaluate("document.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.querySelectorAll('source').forEach(s=>s.removeAttribute('src'));v.load();});true");
    await c.cmd('Page.stopLoading');
    await wait(100);
  }
  async function loadDocument(method, params = {}) {
    // Runtime.evaluate sent during document teardown can be stranded in the
    // old execution context (notably after Stripe's frames were loaded).
    // Wait for the new DOM before querying its context. Component-specific
    // checks below still wait for hydrated UI and real prices; third-party
    // media and Stripe subframes need not finish loading to inspect the UI.
    let finished = false, timer;
    const loaded = new Promise((resolve, reject) => {
      timer = setTimeout(() => {finished = true;reject(Error('Document load timed out: '+method));},30000);
      c.on(event => {
        if (!finished && event.method === 'Page.domContentEventFired') {
          finished = true;clearTimeout(timer);resolve();
        }
      });
    });
    await c.cmd(method, params);
    await loaded;
  }
  async function shot(name) {
    let s = await c.cmd("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      "/tmp/dbc-basket-" + name + ".png",
      Buffer.from(s.data, "base64"),
    );
  }
  async function nativeClick(expression) {
    await c.evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`);
    await wait(80);
    const point = await c.evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await c.cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await c.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  async function removeAndReadd(scope, name) {
    const card = `document.querySelector(${JSON.stringify(scope+'[data-testid="membership-upsell"]')})`;
    await until(`!!(${card})?.querySelector('[data-testid="applied-membership-savings"]')`);
    const hook = await c.evaluate(`(${card}).querySelector('h3').innerText`);
    // Observe the entire transition. Waiting for the card to return and then
    // scrolling to it hid the disappearing-card defect in the older test.
    await c.evaluate(`(()=>{window.__missingMembershipOffer=false;window.__membershipOfferObserver=new MutationObserver(()=>{const card=(${card});if(!card||card.querySelector('h3')?.innerText!==${JSON.stringify(hook)})window.__missingMembershipOffer=true});window.__membershipOfferObserver.observe(document.body,{childList:true,subtree:true,characterData:true})})()`);
    await nativeClick(name === 'drawer' ? `(${card}).querySelector('[data-testid="remove-membership"]')` : `(${card}).querySelector('input[type="checkbox"]')`);
    if (name === 'checkout') {
      await until(`!!document.querySelector('[data-testid="membership-remove-dialog"]')`);
      assert.equal(await c.evaluate(`document.querySelector('[data-testid="membership-remove-dialog"]').innerText.includes(${JSON.stringify(hook.match(/£[\d.]+/)[0])})`),true,'Removal confirmation quotes the exact current net saving');
      await nativeClick(`document.querySelector('[data-testid="keep-membership"]')`);
      await until(`!document.querySelector('[data-testid="membership-remove-dialog"]')`);
      assert.equal(await c.evaluate(`(${card}).dataset.membershipSelected`),'true','Keeping savings leaves membership and consent unchanged');
      await nativeClick(name === 'drawer' ? `(${card}).querySelector('[data-testid="remove-membership"]')` : `(${card}).querySelector('input[type="checkbox"]')`);
      await until(`!!document.querySelector('[data-testid="confirm-remove-membership"]')`);
      await nativeClick(`document.querySelector('[data-testid="confirm-remove-membership"]')`);
    }
    await until(`!!(${card})?.querySelector('[data-testid="add-membership"]')`);
    await until(`localStorage.getItem('dbc_membership_selection_v1')===null&&!document.body.innerText.includes('Subscription credit applied')&&!document.body.innerText.includes('One-time joining credit')`);
    assert.equal(await c.evaluate(`(${card}).querySelector('input[type="checkbox"]')?.checked??false`),false,name+': unticking removes the selected subscription and its credits');
    await shot(name+'-removed-no-rescroll');
    await wait(1200);
    assert.equal(await c.evaluate('window.__missingMembershipOffer'),false, name+': the exact savings hook must stay present throughout removal and repricing');
    await nativeClick(`(${card}).querySelector('h3')`);
    await until(`(${card})?.dataset.membershipSelected==='true'`);
    await wait(1200);
    assert.equal(await c.evaluate('window.__missingMembershipOffer'),false,name+': re-adding must retain the real savings heading');
    await c.evaluate('window.__membershipOfferObserver.disconnect()');
  }
  await navigate(root + "/cart");
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
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="potential-membership-savings"]').innerText`),`Subscribe to save £${potential.toFixed(2)}`,'Use the exact requested hook and authoritative basket saving');
  assert.equal(await c.evaluate(`(()=>{const h=document.querySelector('[data-testid="potential-membership-savings"]');return h.tagName==='H3'&&h===h.parentElement.firstElementChild&&parseFloat(getComputedStyle(h).fontSize)>=30})()`),true,'Basket savings must be the large first heading, above plan and credit details');
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="membership-upsell"]').innerText.includes('Includes £')`),false,'Joining credit is in the canonical headline saving, without an includes-credit line');
  await c.cmd("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  await nativeClick(`document.querySelector('[data-testid="potential-membership-savings"]')`);
  await until(`document.querySelector('[data-testid="membership-upsell"]').dataset.membershipSelected==='true'`);
  assert.equal(await c.evaluate(`document.querySelectorAll('[data-testid="membership-celebration"] .membership-confetti').length`),36,'Whole headline click starts one real confetti burst');
  assert.equal(await c.evaluate(`document.querySelector('.membership-confetti').getAnimations().some(a=>a.playState==='running')`),true,'Confetti is animated, not a static decoration');
  assert.equal(await c.evaluate(`(()=>{const card=document.querySelector('[data-testid="membership-upsell"]');return card.dataset.membershipCompact==='true'&&card.getBoundingClientRect().height<300&&card.querySelector('input[type="checkbox"]').checked;})()`),true,'The smaller tile stays compact after selection and confirms recurring consent');
  await wait(350);
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="membership-upsell"] h3')?.innerText`),`Subscribe to save £${potential.toFixed(2)}`,'The exact hook stays unchanged throughout the selection burst');
  await shot('selection-confetti-mobile');
  await until(`!document.querySelector('[data-testid="membership-celebration"]')`);
  await nativeClick(`document.querySelector('[data-testid="membership-benefits"]')`);
  await until(`!!document.querySelector('[role="dialog"] [data-testid="membership-benefit-studio"]')`);
  assert.equal(await c.evaluate(`(()=>{const dialog=document.querySelector('[data-testid="membership-benefit-studio"]').closest('[role="dialog"]'),text=dialog.textContent.replace(/\\s+/g,' ');return text.includes('Your £99 monthly fee becomes £128.70')&&text.includes('Weekend 2-for-1 / 3-for-2')&&dialog.querySelectorAll('[data-testid^="membership-benefit-"]').length===1;})()`),true,'Full credit and exclusive weekend benefits remain available in the one-plan overlay');
  await nativeClick(`document.querySelector('button[aria-label="Close subscription benefits"]')`);
  await c.evaluate(`document.querySelector('[data-testid="confirm-membership-card"]').click()`);
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-celebration"]')`),false,'Clicking a confirmed card never replays confetti');
  await c.cmd("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await until(
    `!![...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership')`,
  );
  // The same one-click flow is also reachable from the header's slide-out basket.
  await removeAndReadd('', 'cart');
  await nativeClick(`document.querySelector('[data-testid="remove-membership"]')`);
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
  assert.equal(await c.evaluate(`(()=>{const a=document.querySelector('aside[aria-hidden="false"]'),u=a.querySelector('[data-testid="membership-upsell"]'),cards=[...a.querySelectorAll('[data-cart-dates]')];return cards.length>0&&cards.every(el=>!!(el.compareDocumentPosition(u)&Node.DOCUMENT_POSITION_FOLLOWING))&&!u.innerText.includes('first week free')})()`),true,'Subscription pitch follows all gear and has no rental trial offer');
  await until(`!!document.querySelector('aside[aria-hidden="false"] [data-testid="joining-credit-applied"]')`);
  assert.equal(await c.evaluate(`(()=>{const h=document.querySelector('aside[aria-hidden="false"] [data-testid="membership-upsell"] h3');return h===h.parentElement.firstElementChild&&parseFloat(getComputedStyle(h).fontSize)>=30&&/^Subscribe to save £\\d+\\.\\d{2}$/.test(h.innerText)})()`),true,'Side basket uses the same large, first savings heading');
  await shot("drawer-mobile");
  await removeAndReadd('aside[aria-hidden="false"] ', 'drawer');
  await c.evaluate(
    `document.querySelector('aside[aria-hidden="false"] button[aria-label="Close"]').click()`,
  );
  let preferred = await c.evaluate(
    `JSON.parse(localStorage.getItem('dbc_membership_selection_v1'))`,
  );
  assert(preferred?.tier);
  assert.equal(preferred.termsAccepted, undefined);
  assert.equal(preferred.intro, 'none', 'rental checkout only offers paid membership');
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
  assert.equal(await c.evaluate(`document.querySelector('[role="dialog"] h2').innerText`),`Subscribe to save £${paid.membershipNetSaving.toFixed(2)}`,'The recommended-plan benefits also lead with actual rental savings');
  assert.equal(await c.evaluate(`document.querySelectorAll('[role="dialog"] [data-testid^="membership-benefit-"]').length`),1,'Benefits overlay describes only the recommendation');
  assert.equal(await c.evaluate(`document.querySelector('[role="dialog"]').innerText.includes('Choose ')`),false,'No alternate plan choices in the booking flow');
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
  // Real client navigation carries the explicit card-selection consent.
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
    true,
  );
  await until(
    `(()=>{const text=document.querySelector('[data-testid="membership-upsell"]').innerText;return text.includes('First rental: normal verification & refundable security.')&&text.includes('Other perks start next booking.')})()`,
  );
  await until(`document.querySelector('[data-testid="checkout-due"]')?.textContent===${JSON.stringify(new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(paid.combinedTotalDue))}`);
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="checkout-rental-after-credits"]')`),false,'Checkout shows a single final total');
  assert.equal(await c.evaluate(`(()=>{const s=document.querySelector('[data-testid="checkout-summary"]'),secondary=s.querySelector('[data-testid="checkout-secondary-charges"]');const rows=[...secondary.querySelectorAll('[data-secondary-charge]')];return rows.length===3&&rows.every(e=>getComputedStyle(e).fontSize==='11px')&&[...s.querySelectorAll('div')].some(e=>e.children.length===2&&e.firstElementChild.textContent==='Subscription credit applied'&&e.classList.contains('text-emerald-300'))})()`),true,"Checkout separates small subscription/security rows and green applied credit while retaining the full payment total");
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
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-celebration"]')`),false,'Reload never replays a selection celebration');
  await c.evaluate(`document.querySelector('[data-testid="add-membership"]').focus()`);
  await c.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await c.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(`document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]').checked===true`);
  assert.equal(await c.evaluate(`getComputedStyle(document.querySelector('[data-testid="membership-celebration"]')).display`),'none','Reduced motion keeps the selection state without the burst');
  await removeAndReadd('', 'checkout');
  await nativeClick(`document.querySelector('[data-testid="remove-membership"]')`);
  await until(`!!document.querySelector('[data-testid="confirm-remove-membership"]')`);
  await nativeClick(`document.querySelector('[data-testid="confirm-remove-membership"]')`);
  await until(`!!document.querySelector('[data-testid="add-membership"]')`);
  await c.evaluate(
    `document.querySelector('[data-testid="membership-upsell"]').scrollIntoView({block:'center'})`,
  );
  await until(
    `document.querySelector('[data-testid="membership-upsell"]').innerText.includes('Subscribe to save £')`,
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
  assert.equal(await c.evaluate(`(()=>{const h=document.querySelector('[data-testid="potential-membership-savings"]');return h.tagName==='H3'&&h===h.parentElement.firstElementChild&&parseFloat(getComputedStyle(h).fontSize)>=30})()`),true,'Checkout keeps a large top savings heading');
  assert.equal(await c.evaluate(`document.querySelectorAll('[data-testid="membership-chooser"], [data-testid^="membership-plan-"]').length`),0,'Checkout offers only its recommendation, never a plan chooser');
  await shot("checkout-offer-mobile");
  const rentalHook = `Subscribe to save £${potential.toFixed(2)}`;
  await nativeClick(`[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Delivery'))`);
  await until(`!!document.querySelector('textarea[placeholder="Full delivery address"]')||[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Get quote'))`);
  await wait(700);
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="potential-membership-savings"]')?.innerText`),rentalHook,'Incomplete delivery details must not hide a genuine rental saving');
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="checkout-due"]')?.textContent.includes('Calculating')`),true,'A rental-only preview must never become the final delivery payment quote');
  await nativeClick(`[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Pickup'))`);
  await until(`document.querySelector('[data-testid="checkout-due"]')?.textContent.includes('£')`);
  await c.cmd("Emulation.setEmulatedMedia", {features: [{name:"prefers-reduced-motion",value:"no-preference"}]});
  await nativeClick(`document.querySelector('[data-testid="add-membership"]')`);
  await until(`document.querySelector('[data-testid="membership-upsell"] input[type="checkbox"]')?.checked===true`);
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-celebration"]')&&getComputedStyle(document.querySelector('[data-testid="membership-celebration"]')).display!=='none'`),true,'One card click visibly celebrates selection');
  await shot('checkout-selection-confetti-mobile');
  await c.cmd("Emulation.setEmulatedMedia", {features: [{name:"prefers-reduced-motion",value:"reduce"}]});
  assert.equal(await c.evaluate(`document.querySelector('[data-testid="membership-upsell"]').innerText.includes('consent confirmed')`),true,'One-click checkout opt-in confirms monthly terms');
  await until(`document.querySelector('[data-testid="checkout-summary"]').innerText.includes('One-time joining credit')`);
  // The homepage placement is checked against the actual rendered sections.
  await navigate(root + "/");
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
  await navigate(root+"/cart");
  await until(`!!document.querySelector('[data-testid="potential-membership-savings"]')`);
  assert((await c.evaluate(`document.querySelector('[data-testid="potential-membership-savings"]').innerText`)).includes(bigWeekdayQuote.recommendations[0].netSaving.toFixed(2)));
  await shot("weekday-immediate-credit-mobile");
  // Removing real £100 lines crosses Studio → Pro → Starter. Preserve the
  // card space while pricing, with no stale saving or selectable stale plan.
  const eligibleTransitionGear=rows.filter(g=>g.pricing?.daily===100&&!g.displayOnly&&!g.quietDeal);
  assert(eligibleTransitionGear.length>0,"Tier transitions need real £100 equipment");
  // Cart lines have independent keys and can contain the same listing. Keep
  // three real £100 lines even when the live catalogue has fewer distinct kits.
  const transitionGear=Array.from({length:3},(_,n)=>eligibleTransitionGear[n%eligibleTransitionGear.length]);
  let transitionItems=transitionGear.map((g,n)=>({...bigWeekdayItem,key:'tier-transition-'+n,listingId:g._id,title:g.title,slug:g.slug,heroImage:g.heroImage,deposit:g.depositAmount,total:100,perDay:100}));
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify(transitionItems))});localStorage.removeItem('dbc_membership_selection_v1');true`);
  await navigate(root+'/cart');
  await until(`document.querySelector('[data-testid="membership-upsell"]')?.textContent.includes('Studio subscription')&&!!document.querySelector('[data-testid="potential-membership-savings"]')`);
  for(const expectedTier of ['pro','plus']){
    const previousHeight=await c.evaluate(`document.querySelector('[data-testid="membership-upsell"]').getBoundingClientRect().height`);
    // Observe the pending render before clicking: polling after a fast real
    // quote can miss it entirely. Retain both transient-state assertions.
    await c.evaluate(`window.__dbcTierPending=[];window.__dbcTierObserver=new MutationObserver(()=>{const tile=document.querySelector('[data-testid="membership-upsell"]');if(tile?.getAttribute('aria-busy')==='true')window.__dbcTierPending.push({stale:!!document.querySelector('[data-testid="potential-membership-savings"],main [data-testid="add-membership"]'),height:tile.getBoundingClientRect().height});});window.__dbcTierObserver.observe(document.body,{subtree:true,childList:true,attributes:true});true`);
    await nativeClick(`document.querySelector('main button[aria-label^="Remove "]')`);
    await until(`window.__dbcTierPending.length>0`);
    assert.equal(await c.evaluate(`window.__dbcTierPending.some(s=>s.stale)`),false,'Pending repricing never shows an old amount or lets an old plan be selected');
    assert(await c.evaluate(`window.__dbcTierPending.every(s=>s.height>=${previousHeight})`),'The tile keeps its space while recalculating');
    await c.evaluate(`window.__dbcTierObserver.disconnect();true`);
    transitionItems=transitionItems.slice(1);
    const transitionQuote=await cv.action(api.checkout.priceQuote,{...bigWeekdayArgs,items:transitionItems.map(i=>({...bigWeekdayArgs.items[0],listingId:i.listingId,title:i.title}))});
    const offer=transitionQuote.recommendations.find(r=>r.netSaving>0);
    assert.equal(offer.tier,expectedTier);
    await until(`document.querySelector('[data-testid="potential-membership-savings"]')?.innerText===${JSON.stringify('Subscribe to save £'+offer.netSaving.toFixed(2))}`);
    assert.equal(await c.evaluate(`document.querySelector('[data-testid="membership-upsell"]').textContent.includes(${JSON.stringify(offer.name+' subscription')})`),true,'The lower plan and savings update together from the new quote');
  }
  // Compact checkout enrolment includes explicit recurring terms in the checkbox.
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
  await navigate(root + "/cart");
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
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-chooser"], [data-testid="membership-benefits"]')`),false,'No positive savings means no fallback chooser or benefits entry point');
  // A stored subscription preference is not a fresh checkout opt-in.
  await c.evaluate(`localStorage.setItem('dbc_membership_selection_v1',JSON.stringify({tier:'pro',intro:'none'}));true`);
  await reload();
  const noSavingBase = await cv.action(api.checkout.priceQuote, weekdayArgs);
  const noSavingDue = new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format(Math.round((noSavingBase.combinedTotalDue-noSavingBase.depositAmount)*100)/100);
  await until(`document.querySelector('[data-testid="basket-due"]').textContent===${JSON.stringify(noSavingDue)}`);
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="applied-membership-savings"]')`),false,"Stored preference must not apply subscription credit");
  assert.equal(await c.evaluate(`localStorage.getItem('dbc_membership_selection_v1')`),null,"Stale preference is removed");
  assert.equal(await c.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Remove membership')`),false,"No subscription selected after reload");
  await shot("no-savings-mobile");
  // Edit one of two independently dated copies of a listing. Other lines must
  // survive, and the stored base price must come from the real pricing action.
  const secondStart=weekdayStart+30*86400000;
  const secondItem={...weekdayItem,key:cheap._id+":second-dates",start:new Date(secondStart).toISOString().slice(0,10),end:new Date(secondStart).toISOString().slice(0,10)};
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([weekdayItem,secondItem]))});localStorage.removeItem('dbc_membership_selection_v1');true`);
  await navigate(root+"/cart");
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
  await c.evaluate(`document.querySelector('aside[aria-hidden="false"] button[aria-label="Close"]').click()`);
  for(const band of ['deposit-only','deposit-and-hold']){
    const fixture=rows.filter(l=>l.pricing&&!l.displayOnly&&l.depositAmount>0&&(band==='deposit-only'?l.depositAmount<300:l.depositAmount>=300&&l.depositAmount<1000)).sort((a,b)=>a.pricing.daily-b.pricing.daily)[0];
    assert(fixture,`Need a real catalog item in the ${band} value band`);
    const bandArgs={...args,items:[{...args.items[0],listingId:fixture._id,title:fixture.title,start:weekdayStart,end:weekdayStart}]};
    const bandQuote=await cv.action(api.checkout.priceQuote,bandArgs);
    assert.equal(bandQuote.depositAmount,100);assert.equal(bandQuote.depositHoldAmount,Math.round(fixture.depositAmount*10)/100);
    const bandItem={...weekdayItem,key:fixture._id+':security-band',listingId:fixture._id,title:fixture.title,slug:fixture.slug,heroImage:fixture.heroImage,deposit:fixture.depositAmount,total:bandQuote.items[0].total};
    await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([bandItem]))});localStorage.removeItem('dbc_membership_selection_v1');true`);
    await navigate(root+'/checkout');
    const bandDue=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(bandQuote.combinedTotalDue);
    await until(`document.querySelector('[data-testid="checkout-due"]')?.textContent===${JSON.stringify(bandDue)}`);
    assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-chooser"]')`),false,'No checkout fallback chooser even when the recommendation is absent');
    if(!bandQuote.recommendations.some(r=>r.netSaving>0)) assert.equal(await c.evaluate(`!!document.querySelector('[data-testid="membership-upsell"]')`),false,'No positive savings means no membership card on checkout');
    assert.equal(await c.evaluate(`document.querySelectorAll('[data-testid="rental-consent"] input[type="checkbox"]').length`),1,'One combined rental consent checkbox');
    assert.equal(await c.evaluate(`document.querySelector('[data-testid="refundable-security"]').textContent.includes('Fully refundable security')&&document.querySelector('[data-testid="refundable-security"]').textContent.includes('£100.00')`),true);
    assert.equal(await c.evaluate(`document.querySelector('[data-testid="refundable-security"]').innerText.includes('No card hold required.')`),false);
    await c.evaluate(`document.querySelector('[data-testid="rental-agreement-checkbox"]').click()`);
    assert.equal(await c.evaluate(`document.querySelector('[data-testid="rental-agreement-checkbox"]').checked`),true);
    await c.evaluate(`document.querySelector('[data-testid="rental-consent"]').scrollIntoView({block:'center'})`);await wait(200);await shot('consent-'+band+'-mobile');
    await c.evaluate(`document.querySelector('[data-testid="checkout-summary"]').scrollIntoView({block:'center'})`);await wait(200);await shot('security-'+band+'-mobile');
  }
  const clearKit = await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1'))`);
  clearKit.push({...weekdayItem,key:'clear-second-item'});
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify(clearKit))});true`);
  await navigate(root+'/cart');
  await until(`!!document.querySelector('main [data-testid="clear-basket"]')`);
  await until(`document.querySelectorAll('main [data-cart-dates]').length===2`);
  await nativeClick(`document.querySelector('main [data-testid="clear-basket"]')`);
  await until(`document.querySelector('main')?.innerText.includes('Your kit is empty.')`);
  assert.equal(await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1')).length`),0,'Clear basket removes all persisted items');
  assert.equal(await c.evaluate(`localStorage.getItem('dbc_membership_selection_v1')`),null,'Clear basket also removes a selected membership');
  await reload();
  await until(`document.querySelector('main')?.innerText.includes('Your kit is empty.')`);
  // The side basket must expose the same real action in its fixed footer,
  // without scrolling through items or the membership pitch.
  // Seed the next document before hydration. Writing into the just-reloaded
  // empty shell races its initial persistence effect and can erase fixtures.
  const restoreClearKit=await c.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify(clearKit))});localStorage.setItem('dbc_promo_v1','GAFFER10');localStorage.setItem('dbc_membership_selection_v1',JSON.stringify({tier:'studio',intro:'none'}));`});
  await reload();
  await until(`document.querySelectorAll('main [data-cart-dates]').length===2&&document.querySelector('[data-testid="basket-due"]')?.textContent.includes('£')`);
  await c.cmd('Page.removeScriptToEvaluateOnNewDocument',{identifier:restoreClearKit.identifier});
  await nativeClick(`document.querySelector('button[aria-label="Open kit"]')`);
  await until(`!!document.querySelector('aside[aria-hidden="false"] [data-testid="clear-basket"]')`);
  assert.equal(await c.evaluate(`(()=>{const r=document.querySelector('aside[aria-hidden="false"] [data-testid="clear-basket"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`),true,'Clear basket remains on screen at the bottom of the drawer');
  await shot('clear-drawer-mobile');
  await nativeClick(`document.querySelector('aside[aria-hidden="false"] [data-testid="clear-basket"]')`);
  await until(`document.querySelector('aside[aria-hidden="false"]')?.innerText.includes('Your kit is empty.')`);
  assert.equal(await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1')).length`),0);
  assert.equal(await c.evaluate(`localStorage.getItem('dbc_membership_selection_v1')`),null);
  assert.equal(await c.evaluate(`localStorage.getItem('dbc_promo_v1')`),null);
  await reload();
  await until(`document.querySelector('main')?.innerText.includes('Your kit is empty.')`);
  console.log({
    root,
    individualDatesPersistAndReprice:true,
    clearBasketPageAndDrawer:true,
    basketExcludesSecurity:true,
    checkoutFullTotalAndSecondaryCharges:true,
    canonicalSmallRentalSecurityBands:true,
    oneRentalConsentCheckbox:true,
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
