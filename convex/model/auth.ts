import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type AuthCtx = Pick<QueryCtx | MutationCtx | ActionCtx, "auth">;
type DbCtx = QueryCtx | MutationCtx;

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  return identity;
}

export async function requireOwnerId(ctx: AuthCtx) {
  return (await requireIdentity(ctx)).tokenIdentifier;
}

// Pure supplier-membership predicate. Incident-scoped callers (no caller
// identity, e.g. webhook-driven extraction) compare against the incident
// owner's id; everything else goes through requireSupplierOwner.
export function supplierBelongsTo(supplier: { ownerId?: string } | null, ownerId: string) {
  return !!supplier && supplier.ownerId === ownerId;
}

export async function requireSupplierOwner(
  ctx: DbCtx,
  supplierId: Id<"suppliers">,
  message = "Supplier not found",
) {
  const ownerId = await requireOwnerId(ctx);
  const supplier = await ctx.db.get(supplierId);
  if (!supplier || !supplierBelongsTo(supplier, ownerId)) throw new Error(message);
  return { supplier, ownerId };
}

export async function requireIncidentOwner(ctx: DbCtx, incidentId: Id<"incidents">) {
  const ownerId = await requireOwnerId(ctx);
  const incident = await ctx.db.get(incidentId);
  if (!incident) throw new Error("Incident not found");
  if (incident.ownerId !== ownerId) throw new Error("Incident not found");
  return { incident, ownerId };
}

export async function requireNeedOwner(ctx: DbCtx, needId: Id<"needs">) {
  const need = await ctx.db.get(needId);
  if (!need) throw new Error("Need not found");
  const access = await requireIncidentOwner(ctx, need.incidentId);
  return { need, ...access };
}

export async function requireOfferOwner(ctx: DbCtx, offerId: Id<"offers">) {
  const offer = await ctx.db.get(offerId);
  if (!offer) throw new Error("Offer not found");
  const access = await requireNeedOwner(ctx, offer.needId);
  return { offer, ...access };
}

export async function requirePlanOwner(ctx: DbCtx, planId: Id<"allocationPlans">) {
  const plan = await ctx.db.get(planId);
  if (!plan) throw new Error("Plan not found");
  const access = await requireNeedOwner(ctx, plan.needId);
  return { plan, ...access };
}

export async function requireThreadOwner(ctx: DbCtx, threadId: Id<"rfqThreads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new Error("Thread not found");
  const access = await requireNeedOwner(ctx, thread.needId);
  return { thread, ...access };
}
