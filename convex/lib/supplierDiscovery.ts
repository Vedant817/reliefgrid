const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const ROLE_MAILBOX = /^(?:sales|quotes?|procurement|purchasing|orders?|bids?|tenders?|contact|info|commercial|wholesale)$/;

const blockedHosts = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

function usableContactEmail(value: string) {
  const email = value.trim().toLowerCase();
  const [local, host] = email.split("@");
  if (!local || !host) return false;
  if (blockedHosts.has(host) || host.endsWith(".test") || host.endsWith(".example") || host.endsWith(".invalid")) return false;
  return !/^(?:no-?reply|donotreply|do-?not-?reply)$/.test(local) && ROLE_MAILBOX.test(local);
}

export function extractPublicContactEmail(text: string) {
  return [...new Set(text.match(EMAIL_PATTERN)?.map((value) => value.toLowerCase()) ?? [])]
    .find(usableContactEmail);
}

export function supplierRegionLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    return "Online supplier";
  }
}
