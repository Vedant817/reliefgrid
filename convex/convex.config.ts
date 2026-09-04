import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";

const app = defineApp();
app.use(rateLimiter, { name: "rateLimiter" });
app.use(aggregate, { name: "aggregate" });
app.use(presence, { name: "presence" });

export default app;
