import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// Cost guardrail for every billable provider lane. Generous on purpose for
// judge demos; tight enough that a loop bug or spammy supplier cannot drain
// Firecrawl/Groq balances overnight. Keyed per need/offer so one hot need
// never starves the rest.
export const providerLimits = new RateLimiter(components.rateLimiter, {
  extractOffer: { kind: "fixed window", rate: 60, period: HOUR },
  verifySource: { kind: "fixed window", rate: 120, period: HOUR },
  sendRfq: { kind: "fixed window", rate: 30, period: HOUR },
  draftClarification: { kind: "fixed window", rate: 60, period: HOUR },
  sendClarification: { kind: "fixed window", rate: 30, period: HOUR },
  sendHoldNotice: { kind: "fixed window", rate: 30, period: HOUR },
  sendReminder: { kind: "fixed window", rate: 30, period: HOUR },
  discoverSuppliers: { kind: "fixed window", rate: 30, period: HOUR },
  providerUser: { kind: "fixed window", rate: 120, period: HOUR },
  providerGlobal: { kind: "fixed window", rate: 1000, period: HOUR },
});

export async function checkLimit(
  ctx: any,
  name:
    | "extractOffer"
    | "verifySource"
    | "sendRfq"
    | "draftClarification"
    | "sendClarification"
    | "sendHoldNotice"
    | "sendReminder"
    | "discoverSuppliers",
  key: string,
  ownerId?: string,
) {
  const checks = await Promise.all([
    providerLimits.check(ctx, name, { key }),
    providerLimits.check(ctx, "providerGlobal", { key: "deployment" }),
    ...(ownerId ? [providerLimits.check(ctx, "providerUser", { key: ownerId })] : []),
  ]);
  const blocked = checks.find((status) => !status.ok);
  if (blocked) throw new Error(`provider rate limit reached; retry after ${blocked.retryAfter ?? "?"}ms`);
  if (ownerId) await providerLimits.limit(ctx, "providerUser", { key: ownerId });
  await providerLimits.limit(ctx, "providerGlobal", { key: "deployment" });
  await providerLimits.limit(ctx, name, { key });
}
