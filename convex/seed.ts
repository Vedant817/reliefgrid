import { mutation } from "./_generated/server";
import { api } from "./_generated/api";

export const seedDemo = mutation({
  args: {},
  handler: async (ctx): Promise<any> => {
    // Create incident
    const incidentId: any = await ctx.runMutation(api.incidents.createIncident, {
      title: "Flood Shelter — North District",
      description: "Emergency shelter needs water filtration for 200 residents. Deadline today 18:00.",
      deadlineAt: Date.now() + 6 * 60 * 60 * 1000,
    });

    // Create need
    const needId: any = await ctx.runMutation(api.needs.createNeed, {
      incidentId,
      item: "Portable water filters (NSF/ANSI 53)",
      qty: 100,
      deadlineAt: Date.now() + 4 * 60 * 60 * 1000,
      budgetCents: 120000, // $1,200
      certRequired: "NSF/ANSI 53",
      partialAllowed: true,
    });

    // Seed suppliers
    const suppliers: any = await ctx.runMutation(api.suppliers.seedSuppliers, {});

    // Create RFQ threads
    await ctx.runMutation(api.rfq.createRfqThreadsForNeed, {
      needId,
      supplierIds: suppliers.slice(0, 3).map((s: any) => s._id),
    });

    // Simulate supplier replies
    // Apex 70
    await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId,
      supplierId: suppliers[0]._id,
      qty: 70,
      unitPriceCents: 1100,
      arrivalAt: Date.now() + 2 * 60 * 60 * 1000,
      certStatus: "verified",
      conditions: ["subject to stock"],
      confidence: 0.97,
      rawEmailId: "synthetic_apex_1",
      rawBody: "We can deliver 70 filters at $11 each by 4 PM. Certified NSF/ANSI 53. Subject to stock confirmation.",
      language: "en",
    });
    // BlueRiver 100 late
    await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId,
      supplierId: suppliers[1]._id,
      qty: 100,
      unitPriceCents: 900,
      arrivalAt: Date.now() + 24 * 60 * 60 * 1000,
      certStatus: "verified",
      conditions: [],
      confidence: 0.95,
      rawEmailId: "synthetic_blueriver_1",
      rawBody: "We have 100 filters at $9 each, delivery tomorrow morning 10 AM.",
      language: "en",
    });
    // Casa 40 ES
    await ctx.runMutation(api.offers.upsertOfferVersion, {
      needId,
      supplierId: suppliers[2]._id,
      qty: 40,
      unitPriceCents: 1000,
      arrivalAt: Date.now() + 3 * 60 * 60 * 1000,
      certStatus: "verified",
      conditions: [],
      confidence: 0.96,
      rawEmailId: "synthetic_casa_1",
      rawBody: "Podemos entregar 40 unidades certificadas a $10 cada una antes de las 5 PM. Certificación NSF/ANSI 53 verificada.",
      language: "es",
    });

    // Compute allocation
    const allocation: any = await ctx.runMutation(api.allocations.computeAllocation, { needId });

    // Verification mocks
    const offersAfter: any = await ctx.runQuery(api.offers.listOffersByNeed, { needId });
    for (const o of offersAfter) {
      await ctx.runMutation(api.sourceChecks.addSourceCheck, {
        offerId: o._id,
        url: `https://example.com/specs/filter-nsf53`,
        quote: "NSF/ANSI 53 certified — see spec sheet",
        status: "verified",
        reason: "Firecrawl spec verified",
        type: "cert",
      });
      await ctx.runMutation(api.sourceChecks.addSourceCheck, {
        offerId: o._id,
        url: `https://cpsc.gov/recalls`,
        quote: "No active recall found",
        status: "verified",
        reason: "Recall clean",
        type: "recall",
      });
    }

    return { incidentId, needId, suppliers, allocation };
  },
});
