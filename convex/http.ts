import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// AgentMail webhook — receives inbound supplier replies
// In production, verify signature with AGENTMAIL_WEBHOOK_SECRET
http.route({
  path: "/webhooks/agentmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      // Expected: { needId, supplierId, rawEmailId, rawBody, subject? }
      // For MVP, accept flexible payload for synthetic testing
      const { needId, supplierId, rawBody, rawEmailId, qty, unitPriceCents, arrivalAt, certStatus, language } = body;

      if (!needId || !supplierId || !rawBody) {
        return new Response(JSON.stringify({ error: "Missing needId/supplierId/rawBody" }), { status: 400 });
      }

      // Upsert offer version — this triggers realtime + allocator recompute via client or scheduled job
      // Directly use mutation via ctx.runMutation
      const offerId: any = await ctx.runMutation(api.offers.upsertOfferVersion, {
        needId,
        supplierId,
        qty: qty ?? 0,
        unitPriceCents: unitPriceCents ?? 0,
        arrivalAt: arrivalAt ?? Date.now(),
        certStatus: certStatus ?? "needs_review",
        conditions: body.conditions ?? [],
        confidence: body.confidence ?? 0.85,
        rawEmailId: rawEmailId ?? `email_${Date.now()}`,
        rawBody,
        language: language ?? "en",
      });

      // Optionally trigger allocation recompute
      try {
        await ctx.runMutation(api.allocations.computeAllocation, { needId });
      } catch (e) {
        console.error("Allocation recompute failed", e);
      }

      return new Response(JSON.stringify({ ok: true, offerId }), { status: 200 });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
    }
  }),
});

// Synthetic RFQ send simulation — for demo, no real email
http.route({
  path: "/webhooks/simulate-supplier",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    // body: { needId, supplierId, scenario: "apex_70"|"blueriver_100_late"|"casa_40_es" }
    const scenarios: Record<string, any> = {
      apex_70: {
        qty: 70,
        unitPriceCents: 1100,
        arrivalAt: Date.now() + 2 * 60 * 60 * 1000, // 2h
        certStatus: "verified",
        language: "en",
        rawBody: "We can deliver 70 filters at $11 each by 4 PM. Certified NSF/ANSI 53. Subject to stock confirmation.",
        conditions: ["subject to stock"],
        confidence: 0.97,
      },
      blueriver_100_late: {
        qty: 100,
        unitPriceCents: 900,
        arrivalAt: Date.now() + 24 * 60 * 60 * 1000, // tomorrow
        certStatus: "verified",
        language: "en",
        rawBody: "We have 100 filters at $9 each, delivery tomorrow morning 10 AM.",
        conditions: [],
        confidence: 0.95,
      },
      casa_40_es: {
        qty: 40,
        unitPriceCents: 1000,
        arrivalAt: Date.now() + 3 * 60 * 60 * 1000,
        certStatus: "verified",
        language: "es",
        rawBody: "Podemos entregar 40 unidades certificadas a $10 cada una antes de las 5 PM. Certificación NSF/ANSI 53 verificada.",
        conditions: [],
        confidence: 0.96,
      },
    };
    const scenario = scenarios[body.scenario];
    if (!scenario) return new Response(JSON.stringify({ error: "Unknown scenario" }), { status: 400 });

    const needId = body.needId;
    const supplierId = body.supplierId;
    const rawEmailId = `synthetic_${body.scenario}_${Date.now()}`;

    const offerId: any = await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId,
      supplierId,
      rawEmailId,
      rawBody: scenario.rawBody,
      qty: scenario.qty,
      unitPriceCents: scenario.unitPriceCents,
      arrivalAt: scenario.arrivalAt,
      certStatus: scenario.certStatus,
      language: scenario.language,
      conditions: scenario.conditions,
      confidence: scenario.confidence,
    });

    await ctx.runMutation(api.allocations.computeAllocation, { needId });

    return new Response(JSON.stringify({ ok: true, offerId, scenario: body.scenario }), { status: 200 });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, service: "reliefgrid" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
});

export default http;
