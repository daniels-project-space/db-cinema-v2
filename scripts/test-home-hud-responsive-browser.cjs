const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const harness = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function(
  "require",
  harness.slice(0, harness.indexOf('const { ConvexHttpClient }')) + "\nreturn connect;",
)(require);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const client = await connect();
  try {
    await client.cmd("Page.enable");
    for (const width of [390, 768, 1280]) {
      await client.cmd("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await client.cmd("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await client.cmd("Page.navigate", {
        url: process.env.DBC_TEST_URL || "http://127.0.0.1:41902/",
      });
      for (
        let attempt = 0;
        attempt < 100 &&
        !(await client.evaluate(
          `!!document.querySelector('[data-testid="home-hero"] a[href="/gear"]') && !!document.querySelector('[data-testid="viewfinder-location-label"]')`,
        ));
        attempt++
      ) {
        await delay(100);
      }

      const layout = await client.evaluate(`(() => {
        const button = document.querySelector('[data-testid="home-hero"] a[href="/gear"]');
        const location = document.querySelector('[data-testid="viewfinder-location-label"]');
        const iso = document.querySelector('[data-testid="viewfinder-iso-label"]');
        const buttonRect = button.getBoundingClientRect();
        const locationRect = location.getBoundingClientRect();
        const isoRect = iso.getBoundingClientRect();
        const locationVisible = getComputedStyle(location).display !== 'none';
        const isoVisible = getComputedStyle(iso).display !== 'none';
        const overlaps = rect => rect.left < buttonRect.right && rect.right > buttonRect.left && rect.top < buttonRect.bottom && rect.bottom > buttonRect.top;
        return {
          button: { left: buttonRect.left, right: buttonRect.right, top: buttonRect.top, bottom: buttonRect.bottom },
          location: { left: locationRect.left, right: locationRect.right, top: locationRect.top, bottom: locationRect.bottom },
          locationVisible,
          isoVisible,
          buttonOpacity: getComputedStyle(button).opacity,
          hudVisible: getComputedStyle(location.parentElement).display !== 'none',
          locationOverlaps: locationVisible && overlaps(locationRect),
          isoOverlaps: isoVisible && overlaps(isoRect),
        };
      })()`);

      assert(layout.button.right > layout.button.left, `The hero booking action renders at ${width}px`);
      assert(Number(layout.buttonOpacity) > 0.9, `The hero booking action is visible at ${width}px`);
      assert.equal(layout.locationOverlaps, false, `The hero booking action does not overlap the location label at ${width}px`);
      assert.equal(layout.isoOverlaps, false, `The hero booking action does not overlap the ISO label at ${width}px`);
      if (width === 390) {
        assert.equal(layout.hudVisible, false, "The existing compact mobile HUD remains hidden");
      } else if (width === 768) {
        assert.equal(layout.locationVisible, false, "The location label is hidden only through the tablet breakpoint");
        assert.equal(layout.isoVisible, false, "The ISO label is hidden through the same tablet breakpoint");
        assert.equal(layout.hudVisible, true, "The remaining viewfinder HUD stays visible on tablet");
      } else {
        assert.equal(layout.locationVisible, true, "The full location label returns at desktop width");
        assert.equal(layout.isoVisible, true, "The ISO label returns at desktop width");
      }

      await delay(900);
      const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(`/tmp/dbc-home-hud-${width}-after.png`, Buffer.from(screenshot.data, "base64"));
    }

    await client.cmd("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await client.cmd("Page.navigate", {
      url: process.env.DBC_TEST_URL || "http://127.0.0.1:41902/",
    });
    for (
      let attempt = 0;
      attempt < 100 &&
      !(await client.evaluate(
        `!!document.querySelector('[data-testid="mobile-site-menu"]') && !!document.querySelector('.launcher')`,
      ));
      attempt++
    ) {
      await delay(100);
    }
    await delay(500);
    await client.evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    for (
      let attempt = 0;
      attempt < 50 &&
      (await client.evaluate(
        `document.querySelector('[aria-label="Open menu"]')?.getAttribute('aria-expanded') !== 'true'`,
      ));
      attempt++
    ) {
      await delay(50);
    }
    await delay(1000);
    const menuLayout = await client.evaluate(`(() => {
      const rect = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      const menu = document.querySelector('[data-testid="mobile-site-menu"]');
      const footerLabel = menu.querySelector('.hud-label');
      const launcher = document.querySelector('.launcher');
      const menuLinks = [...menu.querySelectorAll('nav a')];
      const menuRect = rect(menu);
      const footerRect = rect(footerLabel);
      const launcherRect = rect(launcher);
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        menu: menuRect,
        menuOpen: menu.getAttribute('aria-hidden') === 'false',
        links: menuLinks.map(link => ({ label: link.innerText.trim(), opacity: Number(getComputedStyle(link).opacity) })),
        footer: footerRect,
        footerVisible: footerRect.top >= 0 && footerRect.bottom <= innerHeight,
        launcher: launcherRect,
        launcherOverlapsFooter: launcherRect.left < footerRect.right && launcherRect.right > footerRect.left && launcherRect.top < footerRect.bottom && launcherRect.bottom > footerRect.top,
      };
    })()`);
    assert.equal(menuLayout.menuOpen, true, "The hamburger button actually opens the mobile menu");
    assert.equal(menuLayout.documentWidth, menuLayout.viewportWidth, "The full-screen mobile menu has no horizontal overflow");
    assert.equal(menuLayout.menu.left, 0, "The mobile menu begins at the left edge");
    assert.equal(menuLayout.menu.right, 390, "The mobile menu uses the full viewport width");
    assert.equal(menuLayout.links.length, 8, "The complete set of menu destinations is present");
    assert(menuLayout.links.every(link => link.opacity > 0.95), "Every menu destination finishes its staggered entrance");
    assert.equal(menuLayout.footerVisible, true, "The menu footer line remains inside the mobile viewport");
    assert.equal(menuLayout.launcherOverlapsFooter, false, "The fixed Gaffer launcher does not cover the menu footer line");
    fs.writeFileSync("/tmp/dbc-home-menu-390-after.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));

    await client.cmd("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(200);
    const desktopMenuLayout = await client.evaluate(`(() => {
      const menu = document.querySelector('[data-testid="mobile-site-menu"]');
      const rect = menu.getBoundingClientRect();
      const footer = menu.querySelector('.hud-label').getBoundingClientRect();
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        menuLeft: rect.left,
        menuRight: rect.right,
        footerVisible: footer.top >= 0 && footer.bottom <= innerHeight,
      };
    })()`);
    assert.equal(desktopMenuLayout.documentWidth, desktopMenuLayout.viewportWidth, "The full-screen desktop menu has no horizontal overflow");
    assert.equal(desktopMenuLayout.menuLeft, 0, "The desktop menu begins at the viewport edge");
    assert.equal(desktopMenuLayout.menuRight, 1280, "The desktop menu fills the viewport");
    assert.equal(desktopMenuLayout.footerVisible, true, "The desktop menu footer remains visible");
    fs.writeFileSync("/tmp/dbc-home-menu-1280-after.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));

    await client.cmd("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await client.cmd("Page.navigate", {
      url: (process.env.DBC_TEST_URL || "http://127.0.0.1:41902/").replace(/\/$/, "/admin"),
    });
    for (
      let attempt = 0;
      attempt < 100 &&
      !(await client.evaluate(
        `!![...document.querySelectorAll('a')].find(link => link.textContent.trim() === 'Owner login')`,
      ));
      attempt++
    ) {
      await delay(100);
    }
    await client.evaluate(`scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
    await delay(200);
    const ownerLoginLayout = await client.evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find(item => item.textContent.trim() === 'Owner login');
      const rect = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      const loginRect = rect(link);
      const launcher = document.querySelector('.launcher');
      const launcherRect = launcher ? rect(launcher) : null;
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        login: loginRect,
        visible: loginRect.top >= 0 && loginRect.bottom <= innerHeight,
        launcherOverlapsLogin: !!launcherRect && launcherRect.left < loginRect.right && launcherRect.right > loginRect.left && launcherRect.top < loginRect.bottom && launcherRect.bottom > loginRect.top,
      };
    })()`);
    assert.equal(ownerLoginLayout.viewportWidth, 390, "The owner login regression uses a phone-sized viewport");
    assert.equal(ownerLoginLayout.documentWidth, ownerLoginLayout.viewportWidth, "The mobile admin login page has no horizontal overflow");
    assert.equal(ownerLoginLayout.visible, true, "Owner login remains fully visible at the bottom of the mobile page");
    assert.equal(ownerLoginLayout.launcherOverlapsLogin, false, "No floating launcher covers the owner login link");
    fs.writeFileSync("/tmp/dbc-owner-login-390-after.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    console.log("PASS hero HUD, full-screen menu, mobile owner login, and responsive boundaries at phone, tablet, and desktop widths.");
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/close/${client.tabId}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
