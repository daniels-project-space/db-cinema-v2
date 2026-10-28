#!/usr/bin/env node

// Vercel runs this from the repository root. Exit 0 to skip a build; exit 1 to build.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const codeFile = /\.(?:[cm]?[jt]sx?)$/i;
const importPattern = /\b(?:from\s*|import\s*\(\s*|import\s+)['"`]([^'"`]+)['"`]|\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
const convexReferencePattern = /['"`]((?:@cvx\/|(?:\.\.\/)+convex\/)[^'"`]+)['"`]/g;

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: root, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function build(reason) {
  console.log(`Vercel build guard: build (${reason})`);
  process.exitCode = 1;
}

function skip(reason) {
  console.log(`Vercel build guard: skip (${reason})`);
  process.exitCode = 0;
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveLocalModule(base) {
  const extensions = [".d.ts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  const candidates = [base];
  if (path.extname(base)) {
    if (/\.m?js$/i.test(base)) candidates.push(
      base.replace(/\.m?js$/i, ".d.ts"),
      base.replace(/\.m?js$/i, ".ts"),
      base.replace(/\.m?js$/i, ".tsx"),
    );
  } else {
    for (const extension of extensions) candidates.push(`${base}${extension}`);
    for (const extension of extensions) candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function frontendConvexFiles() {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  const convexAliases = tsconfig.compilerOptions?.paths?.["@cvx/*"];
  if (!Array.isArray(convexAliases) || convexAliases.length !== 1 || convexAliases[0] !== "./convex/*") {
    throw new Error("the @cvx path mapping changed or is missing");
  }

  const tracked = git(["ls-files", "-z", "--", "src", "shared", "next.config.ts", "next.config.js", "next.config.mjs", "next.config.cjs"], "buffer")
    .toString("utf8").split("\0").filter((file) => file && codeFile.test(file));
  if (!tracked.some((file) => file.startsWith("src/"))) throw new Error("tracked website source files were not found");

  const convexRoot = path.join(root, "convex");
  const scanned = new Set();
  const queue = tracked.map((file) => path.join(root, file));
  const dependencies = new Set();

  while (queue.length) {
    const source = queue.pop();
    const sourceKey = path.relative(root, source).split(path.sep).join("/");
    if (scanned.has(sourceKey)) continue;
    scanned.add(sourceKey);
    const contents = fs.readFileSync(source, "utf8");
    const imports = new Set();
    for (const match of contents.matchAll(importPattern)) imports.add(match[1] || match[2]);

    for (const match of contents.matchAll(convexReferencePattern)) {
      if (!imports.has(match[1])) throw new Error(`unclassified Convex reference in ${sourceKey}`);
    }

    for (const specifier of imports) {
      let base;
      if (specifier.startsWith("@cvx/")) {
        base = path.join(convexRoot, specifier.slice("@cvx/".length));
      } else if (specifier.startsWith(".")) {
        base = path.resolve(path.dirname(source), specifier);
      } else {
        continue;
      }

      if (!inside(root, base)) continue;
      const resolved = resolveLocalModule(base);
      if (!resolved) {
        if (specifier.startsWith("@cvx/") || inside(convexRoot, base)) {
          throw new Error(`cannot resolve website Convex import ${specifier} from ${sourceKey}`);
        }
        continue;
      }
      if (!inside(root, resolved)) throw new Error(`website import escapes repository from ${sourceKey}`);

      if (inside(convexRoot, resolved)) {
        const relative = path.relative(root, resolved).split(path.sep).join("/");
        dependencies.add(relative);
        if (codeFile.test(resolved)) queue.push(resolved);
      }
    }
  }
  return dependencies;
}

function ignoredMetadataOrTests(file) {
  return file === "docs" || file.startsWith("docs/") ||
    file === ".github" || file.startsWith(".github/") ||
    file === ".serena" || file.startsWith(".serena/") ||
    file === "graphify-out" || file.startsWith("graphify-out/") ||
    /(^|\/)__tests__(\/|$)/.test(file) || /(^|\/)[^/]+\.test\.[^/]+$/.test(file);
}

try {
  if (process.env.VERCEL_FORCE_BUILD === "1") {
    build("VERCEL_FORCE_BUILD is set");
  } else if (process.env.VERCEL_GIT_PULL_REQUEST_ID === "92") {
    skip("preserved PR 92 exception");
  } else {
    const previous = process.env.VERCEL_GIT_PREVIOUS_SHA || "";
    if (!/^[0-9a-f]{7,64}$/i.test(previous)) throw new Error("previous deployment SHA is missing or invalid");
    git(["merge-base", "--is-ancestor", previous, "HEAD"]);

    const changed = git(["diff", "--name-only", "--diff-filter=ACDMRT", "--no-renames", "-z", previous, "HEAD", "--"], "buffer")
      .toString("utf8").split("\0").filter(Boolean);
    if (changed.some((file) => file.startsWith("../") || path.isAbsolute(file))) throw new Error("Git returned an unsafe changed path");
    if (changed.length === 0) {
      skip("no source changes");
    } else {
      const websiteConvex = frontendConvexFiles();
      const safe = changed.every((file) => {
        if (ignoredMetadataOrTests(file)) return true;
        if (!file.startsWith("convex/")) return false;
        if (file.startsWith("convex/_generated/")) return false;
        return !websiteConvex.has(file);
      });
      if (safe) skip("only metadata, tests, or Convex backend files outside the website import graph changed");
      else build("a website or generated Convex input changed");
    }
  }
} catch (error) {
  build(error?.message || "the change boundary could not be verified");
}
