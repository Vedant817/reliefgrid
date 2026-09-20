// Outreach coordinator: send sequencing, reply states, and workspace
// derivations shared by App and SupplierOutreach. Offer order
// and eligibility flags live server-side in the workspace read model;
// everything here is the client-owned remainder.

export type OutreachDeps = {
  ensureInbox: (needId: string) => Promise<unknown>;
  createThreads: (needId: string, supplierIds: string[]) => Promise<Array<{ _id: string }>>;
  sendRfq: (threadId: string) => Promise<{ deduped: boolean }>;
};

export type OutreachResult = { sent: number; deduped: number; errors: string[] };

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

// One need, any number of suppliers: inbox first, then threads, then one
// send per thread. Per-thread failures are collected, never thrown, so a
// batch reports exactly what went out and what needs attention.
export async function sendOutreachForNeed(
  deps: OutreachDeps,
  needId: string,
  supplierIds: string[],
): Promise<OutreachResult> {
  try {
    await deps.ensureInbox(needId);
  } catch (cause) {
    return { sent: 0, deduped: 0, errors: [messageOf(cause, "Could not prepare the inbox")] };
  }
  let rows: Array<{ _id: string }>;
  try {
    rows = await deps.createThreads(needId, supplierIds);
  } catch (cause) {
    return { sent: 0, deduped: 0, errors: [messageOf(cause, "Could not create supplier threads")] };
  }
  if (!rows.length) return { sent: 0, deduped: 0, errors: ["Could not create supplier thread"] };
  let sent = 0;
  let deduped = 0;
  const errors: string[] = [];
  for (const thread of rows) {
    try {
      const result = await deps.sendRfq(thread._id);
      if (result.deduped) deduped++;
      else sent++;
    } catch (cause) {
      errors.push(messageOf(cause, "Could not send RFQ"));
    }
  }
  return { sent, deduped, errors };
}

export function countVerifiedOffers(
  offers: Array<{ _id: string }>,
  sourceChecks: Array<{ offerId: string; status: string }>,
) {
  return offers.filter((offer) =>
    sourceChecks.some((check) => check.offerId === offer._id && check.status === "verified"),
  ).length;
}

export function nextStepForWorkspace(args: {
  hasNeed: boolean;
  threadCount: number;
  offerCount: number;
  verifiedCount: number;
  requiresEvidence: boolean;
  hasPlan: boolean;
  planApproved: boolean;
}) {
  if (!args.hasNeed) return "Create your first requirement to begin.";
  if (args.threadCount === 0) return "Add suppliers below and approve outreach.";
  if (args.offerCount === 0) return "Requests are out — wait for replies, or nudge anyone quiet.";
  if (args.requiresEvidence && args.verifiedCount < args.offerCount) return "Verify the remaining certification evidence.";
  if (!args.hasPlan) return "Compute the allocation to see the recommendation.";
  if (!args.planApproved) return "Review the recommendation and approve the plan.";
  return "Done — every supplier has been answered.";
}

export function awaitingReplyThreads<T extends { status: string; agentmailMessageId?: string }>(threads: T[]) {
  return threads.filter((row) => row.status === "sent" && row.agentmailMessageId);
}
