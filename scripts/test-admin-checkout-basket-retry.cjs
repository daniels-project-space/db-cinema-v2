const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const hookState = [];
let hookIndex = 0;
const calls = [];
const queryArguments = [];
let firstAttempt = true;

globalThis.crypto ??= require("node:crypto").webcrypto;
globalThis.btoa ??= value => Buffer.from(value, "binary").toString("base64");

const React = {
  useState(initial) {
    const index = hookIndex++;
    if (!(index in hookState)) hookState[index] = typeof initial === "function" ? initial() : initial;
    return [hookState[index], next => {
      hookState[index] = typeof next === "function" ? next(hookState[index]) : next;
    }];
  },
  useRef(initial) {
    const index = hookIndex++;
    if (!(index in hookState)) hookState[index] = { current: initial };
    return hookState[index];
  },
};
const jsxRuntime = {
  Fragment: Symbol.for("test.fragment"),
  jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
};
const listing = {
  _id: "listing-1",
  title: "Sony FX3 camera",
  slug: "sony-fx3-camera",
  heroImage: "https://images.example.invalid/fx3.jpg",
  imageSources: [],
  bookable: true,
  displayOnly: false,
};
const api = { catalog: { adminListListings: "adminListListings" }, checkoutCarts: { adminShare: "adminShare" } };
const modules = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "convex/react": {
    useQuery: (_reference, args) => {
      queryArguments.push(args);
      return { page: [listing], isDone: args.paginationOpts.cursor === "page-cursor", continueCursor: "page-cursor" };
    },
    useAction: () => async args => {
      calls.push(args);
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("The response was lost after the server accepted the request.");
      }
      return { url: "https://dbcinemarentals.com/cart/quote/example", shareKey: args.shareKey, chatSent: true, emailSent: null };
    },
  },
  "@cvx/_generated/api": { api },
  "@/components/SmartImage": { SmartImage: "img" },
};
const source = fs.readFileSync("src/components/admin/AdminCheckoutBasket.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(name => {
  if (name in modules) return modules[name];
  if (name === "@cvx/_generated/dataModel") return {};
  throw new Error(`Unexpected import ${name}`);
}, componentModule, componentModule.exports);

function render() {
  hookIndex = 0;
  return componentModule.exports.AdminCheckoutBasket({ token: "admin-token", accountId: "account-1", email: "renter@example.invalid" });
}

function findNode(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!tree || typeof tree !== "object") return null;
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}

function nodeByTestId(tree, value) {
  const node = findNode(tree, item => item.props?.["data-testid"] === value);
  assert.ok(node, `expected test id ${value}`);
  return node;
}

function inputByLabel(tree, value) {
  const node = findNode(tree, item => item.props?.["aria-label"] === value);
  assert.ok(node, `expected input ${value}`);
  return node;
}

async function startBasket() {
  let tree = render();
  nodeByTestId(tree, "admin-build-checkout-cart").props.onClick();
  tree = render();
  const addButton = findNode(tree, item => item.type === "button" && item.props?.children === "Add");
  assert.ok(addButton, "catalogue listing can be selected");
  addButton.props.onClick();
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  let pageTree = render();
  nodeByTestId(pageTree, "admin-build-checkout-cart").props.onClick();
  pageTree = render();
  assert.equal(queryArguments.at(-1).paginationOpts.cursor, null, "catalogue browsing starts at the first page");
  const nextPageButton = findNode(pageTree, item => item.props?.["aria-label"] === "Next catalogue page");
  assert.ok(nextPageButton, "the admin can reach catalogue listings beyond the first page");
  nextPageButton.props.onClick();
  pageTree = render();
  assert.equal(queryArguments.at(-1).paginationOpts.cursor, "page-cursor");
  assert.ok(findNode(pageTree, item => item.props?.["aria-label"] === "Previous catalogue page"));
  inputByLabel(pageTree, "Find gear").props.onChange({ target: { value: "Sony" } });
  pageTree = render();
  assert.equal(queryArguments.at(-1).search, "Sony");
  assert.equal(queryArguments.at(-1).paginationOpts.cursor, null, "a new search starts at page one");
  hookState.length = 0;
  queryArguments.length = 0;
  await startBasket();
  let tree = render();
  nodeByTestId(tree, "admin-send-checkout-cart").props.onClick();
  await flush();
  assert.equal(calls.length, 1);
  const firstShareKey = calls[0].shareKey;
  assert.match(firstShareKey, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(calls[0].lines, [{ listingId: "listing-1" }], "an admin can share a real catalogue kit before dates are known");

  tree = render();
  nodeByTestId(tree, "admin-send-checkout-cart").props.onClick();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].shareKey, firstShareKey, "retrying after an uncertain response reuses the idempotency key");

  hookState.length = 0;
  calls.length = 0;
  firstAttempt = true;
  await startBasket();
  tree = render();
  nodeByTestId(tree, "admin-send-checkout-cart").props.onClick();
  await flush();
  const oldShareKey = calls[0].shareKey;

  tree = render();
  inputByLabel(tree, "Kit start date").props.onChange({ target: { value: "2026-11-06" } });
  tree = render();
  inputByLabel(tree, "Kit return date").props.onChange({ target: { value: "2026-11-07" } });
  tree = render();
  nodeByTestId(tree, "admin-send-checkout-cart").props.onClick();
  await flush();

  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].shareKey, oldShareKey, "editing dates starts a distinct cart link after an uncertain request");
  assert.deepEqual(calls[1].lines[0], { listingId: "listing-1", start: Date.UTC(2026, 10, 6), end: Date.UTC(2026, 10, 7) });
  console.log("PASS admin checkout basket retry: uncertain requests keep their idempotency key until basket details change.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
