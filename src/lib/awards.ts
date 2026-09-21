export type AwardDispatchResult = { sent: number; skipped: number; failed: number };

export function awardDispatchMessage(result: AwardDispatchResult) {
  if (result.failed > 0) {
    return `Plan approved, but ${result.failed} supplier notice${result.failed === 1 ? "" : "s"} failed`;
  }
  if (result.sent > 0) {
    return `Plan approved — ${result.sent} supplier notice${result.sent === 1 ? "" : "s"} sent`;
  }
  return "Plan approved — no supplier notices needed";
}
