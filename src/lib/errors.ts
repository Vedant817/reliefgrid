export function userFacingError(cause: unknown, fallback: string) {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  if (/LLM providers failed|no LLM key configured/i.test(raw)) {
    return "Quote extraction is temporarily unavailable. Check the configured extraction service and try again.";
  }
  if (/Web research providers failed|No web research provider configured/i.test(raw)) {
    return "Supplier research is temporarily unavailable. Try again shortly.";
  }
  if (/AgentMail|AGENTMAIL_API_KEY/i.test(raw)) {
    return "Supplier email is temporarily unavailable. The draft and shortlist are still saved.";
  }
  const uncaught = raw.match(/Uncaught Error:\s*([^\r\n]+)/i)?.[1];
  const cleaned = (uncaught ?? raw)
    .replace(/\[CONVEX[^\]]*\]\s*/gi, "")
    .replace(/\[Request ID:[^\]]*\]\s*/gi, "")
    .replace(/^Server Error\s*/i, "")
    .split(/\r?\n/, 1)[0]
    .trim();
  if (/Authentication required|not authenticated/i.test(cleaned)) return "Your session expired. Sign in and try again.";
  if (/rate limit|too many requests/i.test(cleaned)) return "Too many requests. Wait a moment and try again.";
  if (/^(?:Enter|Select|Cannot|Only proposed plans|Plan is stale|This offer|A sent supplier thread|Demo suppliers|Delivery date|No eligible|Requirement|Quote|Supplier email)/i.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}
