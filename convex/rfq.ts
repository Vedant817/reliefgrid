import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";

export const createRfqThreadsForNeed = mutation({
  args: {
    needId: v.id("needs"),
    supplierIds: v.array(v.id("suppliers")),
  },
  handler: async (ctx, args) => {
    const need = await ctx.db.get(args.needId);
    if (!need) throw new Error("Need not found");

    const threads = [];
    for (const supplierId of args.supplierIds) {
      const supplier = await ctx.db.get(supplierId);
      if (!supplier) continue;

      // Check if thread already exists
      const existing = await ctx.db
        .query("rfqThreads")
        .withIndex("by_need", (q) => q.eq("needId", args.needId))
        .collect();
      const already = existing.find((t) => t.supplierId === supplierId);
      if (already) {
        threads.push(already);
        continue;
      }

      const inboxId = `inbox_${args.needId}_${supplierId}_${Date.now()}`;
      const id = await ctx.db.insert("rfqThreads", {
        needId: args.needId,
        supplierId,
        inboxId,
        threadId: `thread_${args.needId}_${supplierId}_${Date.now()}`,
        status: "pending",
        sentAt: Date.now(),
      });
      const thread = await ctx.db.get(id);
      if (thread) threads.push(thread);

      await writeAudit(ctx, {
        entity: "rfqThreads",
        entityId: id,
        action: "create",
        actor: "system",
        meta: JSON.stringify({ supplierId, needId: args.needId }),
      });
    }

    // Also create inbox record
    for (const supplierId of args.supplierIds) {
      const inboxExists = await ctx.db
        .query("inboxes")
        .withIndex("by_need", (q) => q.eq("needId", args.needId))
        .collect();
      const already = inboxExists.find((i) => i.inboxId.includes(supplierId));
      if (!already) {
        await ctx.db.insert("inboxes", {
          needId: args.needId,
          inboxId: `inbox_${args.needId}_${supplierId}`,
          email: `need-${args.needId}@synthetic.reliefgrid.test`,
          createdAt: Date.now(),
        });
      }
    }

    return threads;
  },
});

export const listThreadsByNeed = query({
  args: { needId: v.id("needs") },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("rfqThreads")
      .withIndex("by_need", (q) => q.eq("needId", args.needId))
      .collect();
    // Enrich with supplier
    const enriched = await Promise.all(
      threads.map(async (t) => {
        const supplier = await ctx.db.get(t.supplierId);
        return { ...t, supplier };
      }),
    );
    return enriched;
  },
});

export const updateThreadStatus = mutation({
  args: {
    threadId: v.id("rfqThreads"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { status: args.status, lastReplyAt: Date.now() });
    await writeAudit(ctx, {
      entity: "rfqThreads",
      entityId: args.threadId,
      action: `status:${args.status}`,
      actor: "system",
    });
  },
});
