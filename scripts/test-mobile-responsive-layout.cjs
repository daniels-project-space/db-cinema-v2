const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const hero = read("src/components/HeroCinematic.tsx");
const home = read("src/app/page.tsx");
const reviews = read("src/components/ReviewCarousel.tsx");
const gear = read("src/app/gear/GearCatalogueClient.tsx");
const gearBanner = read("src/components/GearLoopBanner.tsx");
const checkout = read("src/app/checkout/page.tsx");
const gaffer = read("src/components/BotBubble.tsx");

assert.match(hero, /t > \(mobile \? 0\.4 : 0\)/);
assert.match(hero, /data-testid="hero-mobile-category-nav"[\s\S]*?md:hidden/);
assert.match(home, /grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4/);
assert.match(home, /h-\[148px\][\s\S]*?max-\[359px\]:h-\[140px\]/);
assert.match(home, /scroll-mt-24 px-4 py-12 sm:px-6 sm:py-20/);
assert.match(reviews, /min-h-\[232px\][\s\S]*?md:min-h-\[240px\]/);
assert.match(gear, /order-5 px-2 lg:order-1 sm:px-4 xl:px-6/);
assert.match(gear, /order-6 lg:order-2/);
assert.match(gear, /GearLoopBanner motion compact mobileTight/);
assert.match(gear, /grid min-w-0 grid-cols-2 items-end gap-x-3 gap-y-2 sm:mt-4 sm:flex/);
assert.match(gear, /w-full min-w-0 rounded-full[\s\S]*?sm:w-auto sm:min-w-\[155px\]/);
assert.match(gearBanner, /mobileTight \? "h-\[28svh\] min-h-\[210px\] max-h-\[280px\] md:h-\[36svh\] md:min-h-\[300px\] md:max-h-\[360px\]/);
assert.match(gearBanner, /text-white \$\{mobileTight \? "text-3xl md:text-5xl lg:text-6xl" : "text-4xl sm:text-6xl"\}/);
assert.match(gear, /order-3 mt-10 lg:order-4/);
assert.match(gear, /order-4 lg:order-5/);
assert.match(checkout, /flex flex-col gap-2 min-\[480px\]:flex-row min-\[480px\]:gap-3/);
assert.match(checkout, /flex min-w-0 flex-1 items-center gap-3/);
assert.match(gaffer, /hidden h-14 w-14[\s\S]*?sm:flex lg:w-auto/);
assert.match(gaffer, /text-white\/90 lg:block/);

console.log("Mobile responsive layout guards passed");
