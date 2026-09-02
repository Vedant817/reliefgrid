import { cronJobs } from "convex/server";

const crons = cronJobs();

// Deadline at-risk check is handled client-side via queries + scheduler.
// Keep cron slot for future server-side escalation (e.g., notify coordinator).
// Previously scheduled a query which Convex does not allow for crons.

export default crons;
