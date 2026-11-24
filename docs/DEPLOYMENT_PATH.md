# DB Cinema deployment path

Use the repository as the source of truth. Do not deploy an unreviewed working tree with a separate CLI build.

## Website

1. Make and validate the complete change on a feature branch. Run the focused regressions, `npx tsc --noEmit --pretty false`, `git diff --check`, and the CI checks required by `.github/workflows/ci.yml`.
2. Push the finished branch and open a pull request to `main`. Review the exact head commit and wait for CI and its production-build/browser checks to pass. Inspect the Vercel preview for that same commit, including the affected desktop and mobile flows.
3. Merge the pull request. The expected website release path is Vercel's Git integration; do not run `vercel deploy` or create a second CLI build for a matching healthy deployment.
4. Verify in Vercel that the deployment for the merged commit is **Ready** and that the production domain alias points to it. A successful build, merge, or preview URL alone does not prove the production site is live.

The local `.vercel/project.json` links this checkout to the `db-cinema-v2` project, but is intentionally ignored and must not be committed. That local link does not verify the provider's current Git, branch, or domain settings; confirm those in Vercel when publishing.

## Convex backend

The backend has a separate protected release path. `.github/workflows/deploy-convex-production.yml` deploys only after a successful `CI` run for a push to `main`, and only when the tested commit changes Convex runtime inputs (`convex/`, `shared/`, or the listed runtime configuration/dependency files). It uses the `production` GitHub environment and its `DBCINEMA_CONVEX_DEPLOY_KEY`, typechecks the deployment, and records the deployed source SHA in the `convex-production-deployed` tag. If only website inputs changed, the workflow intentionally skips.

Use the manual workflow dispatch only for a deliberate production backend release from `main`, after successful CI for that exact main commit and with its explicit confirmation input. Do not run `npx convex deploy` from a workstation as a shortcut around this gate.

## Release verification and recovery

- Keep the website and backend source SHAs visible in the release record; verify the Vercel deployment SHA and, when applicable, the Convex deployment/tag SHA separately.
- Smoke-test the affected public/admin pages without taking payments, changing customer bookings, or sending messages. For sensitive flows, use the designated synthetic test fixtures.
- If website production is wrong, use the Vercel deployment history to restore the last known-good deployment and investigate the failing commit. For backend changes, make a reviewed revert on `main` and let CI gate a new deployment; never overwrite or force-push history to hide a bad release.
- Do not delete local artifacts, unmerged branches, or other pending work as deployment cleanup. Remove only files proven disposable after the deployed release has been verified.
