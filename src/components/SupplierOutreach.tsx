import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function SupplierOutreach({ needId, suppliers, threads }: { needId?: any; suppliers: any[]; threads: any[] }) {
  const upsertSupplier = useMutation(api.suppliers.upsertSupplier);
  const createThreads = useMutation(api.rfq.createRfqThreadsForNeed);
  const ensureInbox = useAction(api.actions.inboxes.ensureInboxForNeed);
  const sendRfq = useAction(api.actions.sendRfq.approveAndSendRfq);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSend = async (supplierId: any) => {
    if (!needId) return;
    setBusyId(String(supplierId));
    setMessage(null);
    try {
      await ensureInbox({ needId });
      const rows: any[] = await createThreads({ needId, supplierIds: [supplierId] });
      const thread = rows[0];
      if (!thread) throw new Error("Could not create supplier thread");
      const result = await sendRfq({ threadId: thread._id });
      setMessage(result.deduped ? "RFQ was already sent" : "RFQ sent and tracked");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not send RFQ");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Supplier outreach</div>
          <div className="mt-1 text-xs text-slate-500">Add a real supplier, then explicitly approve each RFQ.</div>
        </div>
        <button onClick={() => setAdding((value) => !value)} className="rounded-lg border border-[#29405f] px-2.5 py-1.5 text-xs text-cyan-300">
          {adding ? "Cancel" : "Add supplier"}
        </button>
      </div>

      {adding && (
        <form
          className="mt-4 space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setMessage(null);
            try {
              await upsertSupplier({
                name: String(form.get("name")),
                contactEmail: String(form.get("email")),
                region: String(form.get("region")),
              });
              setAdding(false);
              setMessage("Supplier added; no message sent");
            } catch (cause) {
              setMessage(cause instanceof Error ? cause.message : "Could not add supplier");
            }
          }}
        >
          <input required name="name" aria-label="Supplier name" placeholder="Supplier name" className="w-full input-field" />
          <input required type="email" name="email" aria-label="Supplier email" placeholder="quotes@supplier.org" className="w-full input-field" />
          <input required name="region" aria-label="Supplier region" placeholder="Region or service area" className="w-full input-field" />
          <button className="w-full rounded-xl bg-cyan-400 px-3 py-2 text-xs font-bold text-[#07131c]">Add without sending</button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {suppliers.length === 0 && <div className="rounded-xl border border-dashed border-[#29405f] p-3 text-xs text-slate-500">No suppliers in this workspace.</div>}
        {suppliers.map((supplier) => {
          const thread = threads.find((row) => row.supplierId === supplier._id);
          const synthetic = supplier.contactEmail.endsWith(".test");
          const pending = busyId === String(supplier._id);
          return (
            <div key={supplier._id} className="rounded-xl border border-[#1e2d4a] bg-[#0d1422] p-3">
              <div className="font-medium text-sm">{supplier.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">{supplier.region} · {supplier.contactEmail}</div>
              <button
                disabled={!needId || pending || synthetic || Boolean(thread?.agentmailMessageId)}
                onClick={() => void handleSend(supplier._id)}
                className="mt-2 w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Sending…" : thread?.agentmailMessageId ? `RFQ ${thread.status}` : synthetic ? "Controlled contact" : "Approve & send RFQ"}
              </button>
            </div>
          );
        })}
      </div>
      {message && <div role="status" className="mt-3 text-xs text-slate-300">{message}</div>}
    </section>
  );
}
