const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const client = await connect();
  try {
    await client.cmd('Page.enable');
    await client.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    let marqueeMotionVerified = false;
    let countMarkupVerified = false;

    for (const width of [390, 768, 1280]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41910/' });
      for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="review-eye-glyph"]')`); attempt++) await delay(100);

      const result = await client.evaluate(`(() => {
        const eye = document.querySelector('[data-testid="review-eye-glyph"]');
        const card = eye?.closest('[data-testid="hygglo-trust-card"]');
        const label = eye?.previousElementSibling;
        const panel = card?.querySelector('.hygglo-trust-review-panel');
        if (!eye || !label || !panel) return null;
        const eyeRect = eye.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const style = getComputedStyle(eye);
        return {
          width: eyeRect.width,
          height: eyeRect.height,
          bottom: eyeRect.bottom,
          panelTop: panelRect.top,
          labelRight: labelRect.right,
          eyeLeft: eyeRect.left,
          labelText: label.textContent.trim(),
          insideLabel: label.contains(eye),
          border: style.borderWidth,
          padding: style.padding,
          background: style.backgroundColor,
          href: card.getAttribute('href'),
          overflow: card.scrollHeight > card.clientHeight,
        };
      })()`);

      assert(result, `The review eye renders at ${width}px`);
      assert.equal(result.labelText, 'Trust that is earned');
      assert.equal(result.insideLabel, false);
      assert.equal(result.width, width < 640 ? 36 : 40);
      assert.equal(result.height, width < 640 ? 36 : 40);
      assert.equal(result.border, '0px');
      assert.equal(result.padding, '0px');
      assert.equal(result.background, 'rgba(0, 0, 0, 0)');
      assert(result.eyeLeft > result.labelRight);
      assert(result.panelTop >= result.bottom);
      assert(!result.overflow);
      assert.equal(result.href, '/#reviews');

      if (width === 390) {
        await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"]').scrollIntoView({ block: 'center', behavior: 'instant' })`);
        const cardPoint = await client.evaluate(`(() => { const rect = document.querySelector('[data-testid="hygglo-trust-card"]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
        await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardPoint.x, y: cardPoint.y });
        const hoverReview = await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"] blockquote')?.textContent`);
        let hoveredReviewChanged = false;
        for (let attempt = 0; attempt < 55; attempt++) {
          await delay(100);
          const currentReview = await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"] blockquote')?.textContent`);
          if (currentReview && currentReview !== hoverReview) { hoveredReviewChanged = true; break; }
        }
        assert(hoveredReviewChanged, 'The featured review continues rotating while hovered');

        await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
        const focusReview = await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"] blockquote')?.textContent`);
        await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"]').focus({ preventScroll: true })`);
        let focusedReviewChanged = false;
        for (let attempt = 0; attempt < 55; attempt++) {
          await delay(100);
          const currentReview = await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"] blockquote')?.textContent`);
          if (currentReview && currentReview !== focusReview) { focusedReviewChanged = true; break; }
        }
        assert(focusedReviewChanged, 'The featured review continues rotating while focused');
      }

      if (width === 1280) {
        const counts = await client.evaluate(`(() => {
          const group = document.querySelector('[role="group"][aria-label="Rental and review figures"]');
          return group ? [...group.querySelectorAll('[aria-live="off"]')].map(node => ({
            text: node.textContent.trim(),
            label: node.getAttribute('aria-label'),
            hiddenDuplicates: node.querySelectorAll('.sr-only').length,
          })) : null;
        })()`);
        assert(counts?.length >= 2, 'The homepage renders review and rental statistics');
        assert(counts.every(item => item.label && item.text && item.hiddenDuplicates === 0), 'Counts expose a single final accessible value');
        assert(counts.every(item => !/^0+(?:\.0+)?\+?$/.test(item.text)), 'Initial count markup does not show zero placeholders');
        assert(counts.every(item => item.text === item.label), 'The unscrolled count markup starts at the final value for crawlers');
        countMarkupVerified = true;
      }

      await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"]').scrollIntoView({ block: 'center', behavior: 'instant' })`);
      await delay(150);
      const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-review-eye-${width}.png`, Buffer.from(screenshot.data, 'base64'));

      if (width === 1280) {
        const carousel = await client.evaluate(`(() => {
          const row = document.querySelector('.hygglo-review-marquee');
          const track = row?.querySelector('.hygglo-review-track');
          if (!row || !track) return null;
          row.focus();
          const focusedState = getComputedStyle(track).animationPlayState;
          const rect = row.getBoundingClientRect();
          return { focusedState, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        assert(carousel, 'The lower review carousel renders');
        assert.equal(carousel.focusedState, 'running', 'The lower carousel keeps moving while focused');
        await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: carousel.x, y: carousel.y });
        assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.hygglo-review-track')).animationPlayState`), 'running', 'The lower carousel keeps moving while hovered');
        marqueeMotionVerified = true;

        await client.evaluate(`document.querySelector('[role="group"][aria-label="Rental and review figures"]').scrollIntoView({ block: 'center', behavior: 'instant' })`);
        await delay(100);
        const inProgressCounts = await client.evaluate(`(() => [...document.querySelectorAll('[role="group"][aria-label="Rental and review figures"] [aria-live="off"]')].map(node => ({ text: node.textContent.trim(), final: node.getAttribute('aria-label') })))()`);
        assert(inProgressCounts.some(item => item.text !== item.final), 'The figures animate from zero when scrolled into view');
        await delay(1500);
        const completedCounts = await client.evaluate(`(() => [...document.querySelectorAll('[role="group"][aria-label="Rental and review figures"] [aria-live="off"]')].map(node => ({ text: node.textContent.trim(), final: node.getAttribute('aria-label') })))()`);
        assert(completedCounts.every(item => item.text === item.final), 'The count-up animation settles on the complete figures');
      }
    }

    assert(marqueeMotionVerified && countMarkupVerified, 'Desktop carousel and count markup checks ran');
    console.log('PASS standalone eye, fixed tile bounds, uninterrupted review rotation, and nonzero initial count markup.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
