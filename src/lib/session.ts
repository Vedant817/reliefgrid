// Anonymous coordinator session alias. No PII: a random alias persisted per
// browser tab session, used for presence and as a fallback display name.
const ALIASES = [
  "Ash", "Birch", "Cedar", "Dune", "Ember", "Flint", "Grove", "Harbor",
  "Indigo", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Onyx", "Prairie",
];

export function getSessionAlias(): string {
  try {
    const existing = sessionStorage.getItem("reliefgrid-alias");
    if (existing) return existing;
    const alias = `Coordinator ${ALIASES[Math.floor(Math.random() * ALIASES.length)]}-${Math.floor(100 + Math.random() * 900)}`;
    sessionStorage.setItem("reliefgrid-alias", alias);
    return alias;
  } catch {
    return "Coordinator";
  }
}
