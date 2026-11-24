const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");

function loadComponent(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const { code } = esbuild.transformSync(source, {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
    target: "node18",
  });
  const module = { exports: {} };
  const localRequire = name => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const { SmartImage } = loadComponent("src/components/SmartImage.tsx");
const { ChatAvatar } = loadComponent("src/components/rentals/ChatIdentity.tsx", {
  "next/image": props => React.createElement("img", props),
});

const listingImage = renderToStaticMarkup(React.createElement(SmartImage, {
  src: "https://hygglo.imgix.net/listing.jpg",
  alt: "Sony FX3 camera",
  loading: "eager",
}));
const reviewAvatar = renderToStaticMarkup(React.createElement(ChatAvatar, {
  sender: "renter",
  name: "Review fixture",
  photo: "https://hygglo.imgix.net/profile.jpg",
}));

assert.match(listingImage, /referrerPolicy="no-referrer"/, "Listing images never send the renter's site URL to third-party image hosts");
assert.match(reviewAvatar, /referrerPolicy="no-referrer"/, "Public reviewer photos never send the renter's site URL to third-party image hosts");
assert.match(reviewAvatar, /loading="lazy"/, "Review avatars load lazily");

console.log("PASS public image request privacy: rental photos and opted-in reviewer avatars suppress referrers; review avatars load lazily.");
