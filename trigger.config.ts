import { defineConfig } from "@trigger.dev/sdk/v3";

/**
 * Trigger.dev project for db-cinema-v2.
 * NOTE: `project` ref must be created in the Trigger.dev dashboard
 * (org: Daniels-Project-Space) and pasted here + stored in the vault as
 * TRIGGER_PROJECT_REF_DB_CINEMA. v4 has no non-interactive project-create.
 *
 * Planned tasks: cart-expiry, rmv2-availability-sync, subscription-renewal,
 * pickup/return reminders, deposit-release.
 */
export default defineConfig({
  project: "proj_REPLACE_ME",
  dirs: ["./src/trigger"],
  maxDuration: 300,
});
