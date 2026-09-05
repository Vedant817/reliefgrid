"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

function geminiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no embeddings key configured (GOOGLE_API_KEY)");
  return key;
}

// Gemini gemini-embedding-001 truncated to 768 dimensions (matches the
// by_embedding index), free tier. Single source of embeddings so stored
// vectors and query vectors always share the space.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = geminiKey();
  const out: number[][] = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) throw new Error(`Gemini embeddings HTTP ${res.status}`);
    const body = (await res.json()) as { embedding?: { values?: number[] } };
    const values = body.embedding?.values;
    if (!values || values.length !== 768) throw new Error("bad embedding response");
    out.push(values);
  }
  return out;
}

export const backfillOfferEmbeddings = action({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ embedded: v.number() }),
  handler: async (ctx, args) => {
    const versions: any[] = await ctx.runQuery(api.offers.listAllOfferVersions, {});
    const missing = versions.filter((ver) => !ver.embedding).slice(0, args.limit ?? 20);
    for (const ver of missing) {
      const [vector] = await embedTexts([`${ver.rawBody}`]);
      await ctx.runMutation(api.offers.storeOfferEmbedding, { versionId: ver._id, embedding: vector });
    }
    return { embedded: missing.length };
  },
});

export const findSimilarOffers = action({
  args: { text: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      supplier: v.string(),
      qty: v.number(),
      unitPriceCents: v.number(),
      certStatus: v.string(),
      score: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const [vector] = await embedTexts([args.text]);
    const hits: Array<{ _id: unknown; _score: number }> = await ctx.vectorSearch("offerVersions", "by_embedding", {
      vector,
      limit: args.limit ?? 5,
    });
    const versions: any[] = await ctx.runQuery(api.offers.listAllOfferVersions, {});
    const byId = new Map(versions.map((ver) => [String(ver._id), ver]));
    const suppliers: any[] = await ctx.runQuery(api.suppliers.listSuppliers, {});
    const supplierName = new Map(suppliers.map((s) => [String(s._id), s.name]));
    return hits.map((hit) => {
      const ver = byId.get(String(hit._id));
      return {
        supplier: ver ? (supplierName.get(String(ver.supplierId)) ?? "Unknown supplier") : "Unknown supplier",
        qty: ver?.qty ?? 0,
        unitPriceCents: ver?.unitPriceCents ?? 0,
        certStatus: ver?.certStatus ?? "unknown",
        score: hit._score,
      };
    });
  },
});
