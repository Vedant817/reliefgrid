import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly deadline watchdog: escalates needs due within two hours without
// feasible cover, then schedules a single digest email for the run.
crons.interval("deadline watchdog", { hours: 1 }, internal.watchdog.checkDeadlines, {});

export default crons;
