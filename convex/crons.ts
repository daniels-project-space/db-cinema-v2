import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Keep the storefront catalog + Hygglo availability mirror fresh from RMv2.
// Convex-native scheduling — no Trigger.dev project required for this job.
crons.interval(
  "sync-rmv2-catalog",
  { minutes: 30 },
  api.sync.syncFromRmv2,
  {},
);

export default crons;
