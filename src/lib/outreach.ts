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

export type WorkspaceFlowStep = "requirement" | "suppliers" | "quotes" | "decide";

export const WORKSPACE_FLOW_STEPS: { id: WorkspaceFlowStep; label: string }[] = [
  { id: "requirement", label: "Requirement" },
  { id: "suppliers", label: "Suppliers" },
  { id: "quotes", label: "Quotes" },
  { id: "decide", label: "Decide" },
];

export type WorkspaceFlowArgs = {
  hasNeed: boolean;
  supplierCount: number;
  threadCount: number;
  offerCount: number;
  verifiedCount: number;
  requiresEvidence: boolean;
  hasPlan: boolean;
  planApproved: boolean;
};

export function nextStepForWorkspace(args: WorkspaceFlowArgs) {
  if (!args.hasNeed) return "Create your first requirement to begin.";
  if (args.supplierCount === 0 && args.threadCount === 0 && args.offerCount === 0) {
    return "Add a supplier, then send a request or paste a quote.";
  }
  if (args.offerCount === 0) return "Waiting for replies — or paste a quote you already received.";
  if (args.requiresEvidence && args.verifiedCount < args.offerCount) return "Verify the remaining certification evidence.";
  if (!args.hasPlan) return "Compute the recommendation from the quotes on hand.";
  if (!args.planApproved) return "Review the recommendation and approve the plan.";
  return "Done — every supplier has been answered.";
}

// Same predicate order as nextStepForWorkspace: the coordinator's next
// action, mapped onto the four-step workspace.
export function flowStepForWorkspace(args: WorkspaceFlowArgs): WorkspaceFlowStep {
  if (!args.hasNeed) return "requirement";
  if (args.supplierCount === 0 && args.threadCount === 0 && args.offerCount === 0) return "suppliers";
  if (args.offerCount === 0) return "quotes";
  if (args.requiresEvidence && args.verifiedCount < args.offerCount) return "quotes";
  return "decide";
}

export function flowStepAvailable(
  step: WorkspaceFlowStep,
  args: WorkspaceFlowArgs,
) {
  if (step === "requirement") return true;
  if (step === "suppliers") return args.hasNeed;
  if (step === "quotes") {
    return args.hasNeed && (args.supplierCount > 0 || args.threadCount > 0 || args.offerCount > 0);
  }
  return Boolean(
    args.hasPlan || (args.offerCount > 0 && (!args.requiresEvidence || args.verifiedCount >= args.offerCount)),
  );
}

export function awaitingReplyThreads<T extends { status: string; agentmailMessageId?: string }>(threads: T[]) {
  return threads.filter((row) => row.status === "sent" && row.agentmailMessageId);
}
