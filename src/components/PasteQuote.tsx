import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { userFacingError } from "../lib/errors";

type Supplier = {
  _id: string;
  name: string;
  contactEmail: string;
  isDemo?: boolean;
  demoKey?: string;
};

type Need = {
  item: string;
  qty: number;
  budgetCents: number;
  deadlineAt: number;
  certRequired?: string;
  timezone?: string;
};

function sampleQuote(need: Need, supplier: Supplier) {
  const timeZone = need.timezone || "UTC";
  const leadTime = Math.max(1_000, need.deadlineAt - Date.now());
  const promisedAt = need.deadlineAt - Math.min(24 * 60 * 60 * 1000, Math.floor(leadTime / 2));
  const deliveryPromise = leadTime >= 36 * 60 * 60 * 1000
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(promisedAt)
    : new Date(promisedAt).toISOString();
  const unitPriceCents = Math.max(1, Math.floor((need.budgetCents * 0.85) / need.qty));
  const unitPrice = (unitPriceCents / 100).toFixed(2);
  const certification = need.certRequired
    ? `The goods are supplied as ${need.certRequired} certified; supporting documents are available on request.`
    : "No certification was requested for this order.";
  return [
    `Subject: Quote for ${need.item}`,
    "",
    `Hello, ${supplier.name} can supply ${need.qty} units of ${need.item} at $${unitPrice} per unit.`,
    `We guarantee delivery by ${deliveryPromise}.`,
    certification,
    "This quote is valid for 7 days.",
  ].join("\n");
}

export function PasteQuote({
  needId,
  suppliers,
  need,
}: {
  needId?: string;
  suppliers: Supplier[];
  need?: Need;
}) {
  const ingest = useAction(api.actions.extract.ingestPastedQuote);
  const [supplierId, setSupplierId] = useState(suppliers.length === 1 ? suppliers[0]._id : "");
  const [rawBody, setRawBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (suppliers.length === 1) setSupplierId(suppliers[0]._id);
    else if (supplierId && !suppliers.some((supplier) => supplier._id === supplierId)) setSupplierId("");
  }, [supplierId, suppliers]);

  if (!needId) return null;

  const extract = async (selectedSupplierId: string, body: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await ingest({ needId: needId as any, supplierId: selectedSupplierId as any, rawBody: body.trim() });
      setMessage("Quote extracted through the live workflow. Review the evidence and delivery date above.");
    } catch (cause) {
      setError(userFacingError(cause, "Could not extract the pasted quote"));
    } finally {
      setBusy(false);
    }
  };

  const demoSupplier = suppliers.find((supplier) => supplier.isDemo);

  return (
    <form
      className="mt-4 rounded-lg border border-hairline bg-paper p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void extract(supplierId, rawBody);
      }}
    >
      <div className="eyebrow">Paste a quote you already have</div>
      <p className="mt-1 text-[11px] leading-relaxed text-soft">
        Use this when the supplier already emailed you. Live extraction reads quantity, price, and delivery promises without inventing missing fields.
      </p>
      <label className="mt-3 block text-xs font-medium text-soft">
        Supplier
        <select
          required
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          aria-label="Supplier for pasted quote"
          disabled={!suppliers.length || busy}
          className="input-field mt-1"
        >
          <option value="">{suppliers.length ? "Select supplier" : "Add a supplier first"}</option>
          {suppliers.map((supplier) => (
            <option key={supplier._id} value={supplier._id}>
              {supplier.name}{supplier.isDemo ? " — Demo supplier" : ` — ${supplier.contactEmail}`}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-medium text-soft">
        Quote email
        <textarea
          required
          value={rawBody}
          onChange={(event) => setRawBody(event.target.value)}
          minLength={8}
          rows={6}
          placeholder="Paste the supplier's quote email"
          className="input-field mt-1 min-h-28"
        />
      </label>
      {demoSupplier && need ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const body = sampleQuote(need, demoSupplier);
            setSupplierId(demoSupplier._id);
            setRawBody(body);
            void extract(demoSupplier._id, body);
          }}
          className="mt-3 w-full rounded-lg border border-ledger bg-sheet px-3 py-2 text-xs font-semibold text-ledger hover:bg-[#eef4f0] disabled:opacity-50"
        >
          {busy ? "Extracting sample quote…" : "Use sample quote"}
        </button>
      ) : null}
      <button
        disabled={busy || !suppliers.length || !supplierId || rawBody.trim().length < 8}
        className="mt-2 w-full rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
      >
        {busy ? "Extracting…" : "Extract quote"}
      </button>
      {message && <div role="status" className="mt-2 text-[11px] text-ledger">{message}</div>}
      {error && <div role="alert" className="mt-2 text-[11px] text-seal">{error}</div>}
    </form>
  );
}
