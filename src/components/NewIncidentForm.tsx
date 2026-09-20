import { useState } from "react";

export type LineItem = {
  item: string;
  qty: number;
  budgetDollars: number;
};

export type RequirementValues = {
  title: string;
  description: string;
  items: LineItem[];
  deadlineLocal: string;
  certification: string;
  evidenceKey: string;
  deliveryLocation: string;
  timezone: string;
};

const blankItem = (): LineItem => ({ item: "", qty: 0, budgetDollars: 0 });

export function NewIncidentForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (values: RequirementValues) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LineItem[]>([blankItem()]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4" role="dialog" aria-modal="true" aria-label="Create urgent requirement">
      <form
        className="my-8 w-full max-w-2xl rounded-xl border border-hairline bg-sheet p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError(null);
          try {
            const parsed = items.map((_, index) => ({
              item: String(form.get(`item-${index}`) ?? "").trim(),
              qty: Number(form.get(`qty-${index}`)),
              budgetDollars: Number(form.get(`budget-${index}`)),
            }));
            await onCreate({
              title: String(form.get("title")),
              description: String(form.get("description")),
              items: parsed,
              deadlineLocal: String(form.get("deadline")),
              certification: String(form.get("certification")),
              evidenceKey: String(form.get("evidenceKey")),
              deliveryLocation: String(form.get("location")),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not create requirement");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="text-[13px] font-semibold text-ledger">New urgent requirement</div>
        <h2 className="mt-2 font-serif text-[26px] font-bold tracking-tight">What must arrive, where, and by when?</h2>
        <p className="mt-1 text-sm text-soft">ReliefGrid will prepare comparable supplier outreach. Nothing is sent without approval.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-medium text-soft md:col-span-2">Incident name<input required name="title" placeholder="Urgent equipment procurement" className="input-field mt-1" /></label>
          <label className="text-xs font-medium text-soft md:col-span-2">Operational context<textarea name="description" placeholder="Residents affected, access constraints, substitution rules" className="input-field mt-1 min-h-20" /></label>
        </div>
        <div className="mt-4 space-y-3">
          <div className="eyebrow">Line items — one request per row</div>
          {items.map((_row, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-hairline bg-paper p-3 md:grid-cols-[1fr_110px_130px_auto]">
              <label className="text-xs font-medium text-soft">Item<input required name={`item-${index}`} placeholder={index === 0 ? "Portable water filters" : "Item name"} className="input-field mt-1" /></label>
              <label className="text-xs font-medium text-soft">Quantity<input required min="1" step="1" type="number" name={`qty-${index}`} className="input-field mt-1" /></label>
              <label className="text-xs font-medium text-soft">Budget, USD<input required min="0" step="0.01" type="number" name={`budget-${index}`} className="input-field mt-1" /></label>
              {items.length > 1 ? (
                <button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="self-end rounded-lg border border-hairline px-2.5 py-2 text-xs text-soft hover:bg-sheet">Remove</button>
              ) : <span />}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((current) => (current.length >= 10 ? current : [...current, blankItem()]))}
            className="rounded-lg border border-dashed border-[#cfc9b8] px-3 py-2 text-xs font-medium text-ledger hover:bg-paper"
          >
            + Add another item
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-medium text-soft">Required arrival<input required type="datetime-local" name="deadline" className="input-field mt-1" /></label>
          <label className="text-xs font-medium text-soft">Required certification<input name="certification" placeholder="NSF/ANSI 53" className="input-field mt-1" /></label>
          <label className="text-xs font-medium text-soft">Product/model evidence key<input name="evidenceKey" placeholder="Model NF-53 or lot A17" className="input-field mt-1" /></label>
          <label className="text-xs font-medium text-soft">Delivery location<input required name="location" placeholder="North District shelter receiving" className="input-field mt-1" /></label>
        </div>
        {error && <div className="mt-4 rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3 text-sm text-seal">{error}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-hairline bg-sheet px-4 py-2 text-sm font-medium text-ink hover:bg-paper">Cancel</button>
          <button disabled={busy} className="rounded-lg bg-ledger px-4 py-2 text-sm font-medium text-white hover:bg-ledger-deep disabled:opacity-50">{busy ? "Creating…" : "Create requirement"}</button>
        </div>
      </form>
    </div>
  );
}
