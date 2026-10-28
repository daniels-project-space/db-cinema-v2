# Vercel build ignore policy

The Vercel project runs `node scripts/vercel-ignore-build.cjs` before each Git deployment. It keeps the existing force-build override and PR 92 exception, and builds when deployment history is missing or cannot be checked.

Docs, CI metadata, Serena metadata, Graphify output, and the existing test-only path patterns can skip a website build. Convex changes can skip only when they are outside the website's current import graph. Generated Convex files and imported Convex modules always trigger a build. The script scans tracked website and shared modules; if the `@cvx` mapping or an import cannot be resolved, it builds.

The repository CI workflow continues to run its typecheck, tests, browser checks, and Next.js build. Keep this policy aligned with that workflow and review new imports into `convex/` before relying on backend-only skips.
