import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly deadline watchdog: escalates needs due within two hours without
// feasible cover. Escalation ends at the audit trail (at most one per need
// per half-day); nothing is emailed.
crons.interval("deadline watchdog", { hours: 1 }, internal.watchdog.checkDeadlines, {});

export default crons;
