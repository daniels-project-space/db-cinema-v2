import { defineConfig } from "@trigger.dev/sdk/v3";

/**
 * Trigger.dev project for db-cinema-v2.
 * Dedicated project in Daniels Project space. The environment override keeps
 * local/preview tooling portable without ever sharing another app's project.
 *
 * Planned tasks: cart-expiry, rmv2-availability-sync, subscription-renewal,
 * pickup/return reminders, deposit-release.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_mmebaxukqjxlxocffgew",
  dirs: ["./src/trigger"],
  maxDuration: 300,
});
