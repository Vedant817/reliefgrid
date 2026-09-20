import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

type Supplier = { _id: string; name: string; contactEmail: string };

export function PasteQuote({
  needId,
  suppliers,
}: {
  needId?: string;
  suppliers: Supplier[];
}) {
  const ingest = useAction(api.actions.extract.ingestPastedQuote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!needId) return null;

  return (
    <form
      className="mt-4 rounded-lg border border-hairline bg-paper p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const supplierId = String(data.get("supplierId") ?? "");
        const rawBody = String(data.get("rawBody") ?? "").trim();
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const result = await ingest({ needId: needId as any, supplierId: supplierId as any, rawBody });
          const source = result.provider === "groq" ? "Groq (GPT-OSS)" : "OpenAI";
          setMessage(`Quote extracted with ${source}. Review it in the list above.`);
          form.reset();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not extract the pasted quote");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="eyebrow">Paste a quote you already have</div>
      <p className="mt-1 text-[11px] leading-relaxed text-soft">
        Use this when the supplier already emailed you. The live model extracts quantity, price, and arrival. It does not invent missing fields.
      </p>
      <label className="mt-3 block text-xs font-medium text-soft">
        Supplier
        <select required name="supplierId" aria-label="Supplier for pasted quote" disabled={!suppliers.length} className="input-field mt-1">
          <option value="">{suppliers.length ? "Select supplier" : "Add a supplier first"}</option>
          {suppliers.map((supplier) => (
            <option key={supplier._id} value={supplier._id}>{supplier.name} — {supplier.contactEmail}</option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-medium text-soft">
        Quote email
        <textarea required name="rawBody" minLength={8} rows={6} placeholder="Paste the supplier's quote email" className="input-field mt-1 min-h-28" />
      </label>
      <button
        disabled={busy || !suppliers.length}
        className="mt-3 w-full rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
      >
        {busy ? "Extracting…" : "Extract quote"}
      </button>
      {message && <div role="status" className="mt-2 text-[11px] text-ledger">{message}</div>}
      {error && <div role="alert" className="mt-2 text-[11px] text-seal">{error}</div>}
    </form>
  );
}
