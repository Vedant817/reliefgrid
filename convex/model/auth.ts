import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type AuthCtx = Pick<QueryCtx | MutationCtx | ActionCtx, "auth">;
type DbCtx = QueryCtx | MutationCtx;
type Identity = { tokenIdentifier: string; subject: string; issuer: string };

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  return identity;
}

// Convex Auth subjects are `userId|sessionId`, so tokenIdentifier is not a
// workspace key: it changes after sign-out/sign-in. New records use the stable
// users-table ID. The prefix is only for reading records created before this
// fix, whose ownerId was `issuer|userId|sessionId`.
export function ownerAccessFromIdentity(identity: Identity, userId: string) {
  const subjectSuffix = identity.subject.startsWith(`${userId}|`)
    ? identity.subject.slice(userId.length)
    : null;
  const tokenPrefix = identity.tokenIdentifier.endsWith(identity.subject)
    ? identity.tokenIdentifier.slice(0, -identity.subject.length)
    : `${identity.issuer}|`;
  const legacyOwnerPrefix = subjectSuffix ? `${tokenPrefix}${userId}|` : null;
  return {
    ownerId: userId,
    keys: [userId, identity.tokenIdentifier],
    legacyOwnerPrefix,
  };
}

export function ownerMatches(
  stored: string | undefined,
  access: { keys: string[]; legacyOwnerPrefix: string | null },
) {
  return !!stored && (access.keys.includes(stored) || (!!access.legacyOwnerPrefix && stored.startsWith(access.legacyOwnerPrefix)));
}

export async function requireOwnerKeys(ctx: AuthCtx) {
  const identity = await requireIdentity(ctx);
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authentication required");
  return { identity, ...ownerAccessFromIdentity(identity, String(userId)) };
}

export async function requireOwnerId(ctx: AuthCtx) {
  return (await requireOwnerKeys(ctx)).ownerId;
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
  const supplier = await ctx.db.get(supplierId);
  const access = await requireOwnerKeys(ctx);
  if (!supplier || !ownerMatches(supplier.ownerId, access)) throw new Error(message);
  return { supplier, ...access };
}

export async function requireIncidentOwner(ctx: DbCtx, incidentId: Id<"incidents">) {
  const access = await requireOwnerKeys(ctx);
  const incident = await ctx.db.get(incidentId);
  if (!incident) throw new Error("Incident not found");
  if (!ownerMatches(incident.ownerId, access)) throw new Error("Incident not found");
  return { incident, ...access };
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
