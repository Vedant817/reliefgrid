import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
app.use(rateLimiter, { name: "rateLimiter" });
app.use(aggregate, { name: "aggregate" });
// Note: @agentmail/convex v0.1.0 declares no component env, so its send
// workpool cannot see deployment keys. Sends stay on our proven direct lane
// (actions/sendRfq); the component is wired for Svix-verified inbound ingest
// and reactive thread state, whose webhook secret is passed explicitly.
app.use(agentmail);
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

export default app;
