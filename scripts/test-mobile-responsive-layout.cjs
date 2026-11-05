const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const hero = read("src/components/HeroCinematic.tsx");
const home = read("src/app/page.tsx");
const reviews = read("src/components/ReviewCarousel.tsx");
const gear = read("src/app/gear/GearCatalogueClient.tsx");
const checkout = read("src/app/checkout/page.tsx");

assert.match(hero, /t > \(mobile \? 0\.4 : 0\)/);
assert.match(hero, /data-testid="hero-mobile-category-nav"[\s\S]*?md:hidden/);
assert.match(home, /grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4/);
assert.match(home, /h-\[148px\][\s\S]*?max-\[359px\]:h-\[140px\]/);
assert.match(home, /scroll-mt-24 px-4 py-12 sm:px-6 sm:py-20/);
assert.match(reviews, /min-h-\[232px\][\s\S]*?md:min-h-\[240px\]/);
assert.match(gear, /order-2 px-2 sm:order-1 sm:px-4 xl:px-6/);
assert.match(gear, /order-3 mt-10 sm:order-4/);
assert.match(gear, /order-4 sm:order-5/);
assert.match(checkout, /flex flex-col gap-2 min-\[480px\]:flex-row min-\[480px\]:gap-3/);
assert.match(checkout, /flex min-w-0 flex-1 items-center gap-3/);

console.log("Mobile responsive layout guards passed");
