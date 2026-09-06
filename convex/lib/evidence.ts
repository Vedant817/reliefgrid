// Shared evidence-matching primitives for every Firecrawl-backed check
// (offer verification, public recall watch). One normalization, one
// authority rule, one recall language — callers differ in match POLICY
// (which identifiers, what verdict), never in these primitives.

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// `body` must already be normalized; callers normalize the scraped page
// text once, then test every identifier against it.
export function containsExactPhrase(body: string, phrase: string) {
  const escaped = normalized(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return Boolean(escaped) && new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(body);
}

export function authorityForHostname(hostname: string): "authoritative" | "supporting" {
  const host = hostname.toLowerCase();
  return host.endsWith(".gov") || host === "nsf.org" || host.endsWith(".nsf.org") || host === "who.int" || host.endsWith(".who.int")
    ? "authoritative"
    : "supporting";
}

export function isAuthoritativeHostname(hostname: string) {
  return authorityForHostname(hostname) === "authoritative";
}

// Recall language is matched against normalized (lowercase, punctuation
// stripped) page text. Union of every pattern the product has ever used so
// no path silently narrows what counts as a recall.
export const RECALL_LANGUAGE =
  /recall active|has been recalled|recalled|recall notice|stop (using|distribution|sale)|do not use|product recall/;
