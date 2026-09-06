import { useState } from "react";

type Values = {
  title: string;
  description: string;
  item: string;
  qty: number;
  budgetDollars: number;
  deadlineLocal: string;
  certification: string;
  evidenceKey: string;
  deliveryLocation: string;
  timezone: string;
};

export function NewIncidentForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (values: Values) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const defaultDeadline = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Create urgent requirement">
      <form
        className="w-full max-w-2xl rounded-2xl border border-[#29405f] bg-[#111827] p-6 shadow-2xl"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError(null);
          try {
            await onCreate({
              title: String(form.get("title")),
              description: String(form.get("description")),
              item: String(form.get("item")),
              qty: Number(form.get("qty")),
              budgetDollars: Number(form.get("budget")),
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
        <div className="text-xs tracking-[0.14em] uppercase text-cyan-300">New urgent requirement</div>
        <h2 className="mt-2 text-2xl font-bold">What must arrive, where, and by when?</h2>
        <p className="mt-1 text-sm text-slate-400">ReliefGrid will prepare comparable supplier outreach. Nothing is sent without approval.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-slate-400 md:col-span-2">Incident name<input required name="title" placeholder="Flood shelter water response" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400 md:col-span-2">Operational context<textarea name="description" placeholder="Residents affected, access constraints, substitution rules" className="mt-1 w-full input-field min-h-20" /></label>
          <label className="text-xs text-slate-400">Item<input required name="item" placeholder="Portable water filters" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Quantity<input required min="1" step="1" type="number" name="qty" defaultValue="100" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Budget, USD<input required min="0" step="0.01" type="number" name="budget" defaultValue="1200" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Required arrival<input required type="datetime-local" name="deadline" defaultValue={defaultDeadline} className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Required certification<input name="certification" placeholder="NSF/ANSI 53" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Product/model evidence key<input name="evidenceKey" placeholder="Model NF-53 or lot A17" className="mt-1 w-full input-field" /></label>
          <label className="text-xs text-slate-400">Delivery location<input required name="location" placeholder="North District shelter receiving" className="mt-1 w-full input-field" /></label>
        </div>
        {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-[#29405f] text-sm">Cancel</button>
          <button disabled={busy} className="px-4 py-2 rounded-xl bg-cyan-400 text-[#07131c] text-sm font-bold disabled:opacity-50">{busy ? "Creating…" : "Create requirement"}</button>
        </div>
      </form>
    </div>
  );
}
