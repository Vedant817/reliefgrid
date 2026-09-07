const STOPWORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "will",
  "would",
  "your",
  "about",
  "into",
  "over",
  "after",
  "before",
  "between",
  "under",
  "again",
  "further",
  "once",
  "here",
  "when",
  "where",
  "which",
  "while",
  "also",
  "just",
  "like",
  "such",
  "than",
  "then",
  "them",
  "they",
  "there",
  "their",
  "what",
  "could",
  "should",
]);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return new Set(words);
}

// Score sibling needs by distinct significant-word overlap with an inbound
// email body. Pure (no Convex imports) so it stays unit-testable.
export function matchNeedsByKeywords(
  body: string,
  needs: Array<{ _id: string; item: string }>,
): string[] {
  const bodyWords = tokenize(body);
  if (bodyWords.size === 0) return [];
  const scored: Array<{ id: string; score: number; index: number }> = [];
  needs.forEach((need, index) => {
    const itemWords = tokenize(need.item);
    let score = 0;
    for (const w of itemWords) {
      if (bodyWords.has(w)) score += 1;
    }
    if (score > 0) scored.push({ id: need._id, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.id);
}
