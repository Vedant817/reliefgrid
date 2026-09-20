export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDeadline(ts: number) {
  const diff = ts - Date.now();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (diff < 0) return "Overdue";
  if (hours <= 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

export function deadlineUrgency(ts: number): "ok" | "warn" | "critical" {
  const diff = ts - Date.now();
  if (diff < 0) return "critical";
  if (diff < 2 * 60 * 60 * 1000) return "critical";
  if (diff < 6 * 60 * 60 * 1000) return "warn";
  return "ok";
}

// Backend statuses use machine names (needs_review, awaiting_approval).
// Human-facing surfaces show plain words instead.
export function humanizeStatus(status: string) {
  const known: Record<string, string> = {
    needs_review: "Needs review",
    awaiting_responses: "Awaiting responses",
    awaiting_approval: "Awaiting approval",
    partially_fulfilled: "Partially fulfilled",
    clarification_sending: "Sending clarification",
    clarification_sent: "Clarification sent",
  };
  if (known[status]) return known[status];
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Allocator reasons are written for the audit trace; the matrix shows the
// plain-language equivalent.
export function friendlyReason(reason: string) {
  if (reason.includes("cheapest feasible")) return "Lowest-cost option that meets the deadline";
  if (reason.includes("evidence recheck")) return "Reselected after an evidence recheck";
  if (reason.includes("recovery workflow")) return "Selected by the approved recovery";
  return reason;
}

// Opaque token identifiers stay hidden; emails and names from Convex Auth
// are shown as the human approver.
export function displayApprover(approvedBy?: string | null) {
  if (!approvedBy) return "Pending approval";
  if (approvedBy.includes("@")) return approvedBy;
  if (approvedBy.includes("|")) return "Workspace coordinator";
  return approvedBy;
}
