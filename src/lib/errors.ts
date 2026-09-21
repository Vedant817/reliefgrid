export function userFacingError(cause: unknown, fallback: string) {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const uncaught = raw.match(/Uncaught Error:\s*([^\r\n]+)/i)?.[1];
  if (uncaught) return uncaught.trim();
  const cleaned = raw
    .replace(/^\[CONVEX[^\]]*\]\s*/i, "")
    .replace(/^\[Request ID:[^\]]*\]\s*/i, "")
    .replace(/^Server Error\s*/i, "")
    .split(/\r?\n/, 1)[0]
    .trim();
  return cleaned || fallback;
}
