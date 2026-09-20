import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireNeedOwner, requireSupplierOwner } from "./model/auth";

async function pasteId(rawBody: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return `paste:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// Authorizes a coordinator-pasted supplier quote and mints a stable id so
// the same email text is idempotent. Extraction stays in the Node action.
export const preparePastedQuote = internalMutation({
  args: {
    needId: v.id("needs"),
    supplierId: v.id("suppliers"),
    rawBody: v.string(),
  },
  returns: v.object({
    ownerId: v.string(),
    rawEmailId: v.string(),
    rawBody: v.string(),
  }),
  handler: async (ctx, args) => {
    const { ownerId, need } = await requireNeedOwner(ctx, args.needId);
    await requireSupplierOwner(ctx, args.supplierId);
    const rawBody = args.rawBody.trim();
    if (rawBody.length < 8) throw new Error("Pasted quote must be at least 8 characters");
    if (rawBody.length > 100_000) throw new Error("Pasted quote must be at most 100000 characters");
    if (need.status === "awarded") throw new Error("This requirement already has an approved plan");
    return { ownerId, rawEmailId: await pasteId(rawBody), rawBody };
  },
});
