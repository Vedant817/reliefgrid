import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { awaitingReplyThreads, sendOutreachForNeed } from "../lib/outreach";

type DiscoveredSupplier = { name: string; url: string; snippet: string };

export function SupplierOutreach({ needId, needs, suppliers, threads }: { needId?: any; needs: any[]; suppliers: any[]; threads: any[] }) {
  const upsertSupplier = useMutation(api.suppliers.upsertSupplier);
  const createThreads = useMutation(api.rfq.createRfqThreadsForNeed);
  const ensureInbox = useAction(api.actions.inboxes.ensureInboxForNeed);
  const sendRfq = useAction(api.actions.sendRfq.approveAndSendRfq);
  const sendReminder = useAction(api.actions.sendReminder.sendReminder);
  const discover = useAction(api.actions.discoverSuppliers.discoverSuppliers);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reminderThread, setReminderThread] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredSupplier[] | null>(null);
  const [searchProvider, setSearchProvider] = useState<"firecrawl" | "exa" | null>(null);
  const [prefill, setPrefill] = useState<{ name: string; key: number } | null>(null);

  const awaitingReply = awaitingReplyThreads(threads);

  const outreachDeps = {
    ensureInbox: (id: string) => ensureInbox({ needId: id as any }),
    createThreads: (id: string, supplierIds: string[]) => createThreads({ needId: id as any, supplierIds: supplierIds as any }) as unknown as Promise<Array<{ _id: string }>>,
    sendRfq: (threadId: string) => sendRfq({ threadId: threadId as any }),
  };

  const handleSend = async (supplierId: any) => {
    if (!needId) return;
    setBusyId(String(supplierId));
    setMessage(null);
    try {
      const result = await sendOutreachForNeed(outreachDeps, String(needId), [String(supplierId)]);
      if (result.errors.length && result.sent === 0 && result.deduped === 0) setMessage(result.errors[0]);
      else setMessage(result.deduped > 0 && result.sent === 0 ? "Request was already sent" : "Request sent and tracked");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not send request");
    } finally {
      setBusyId(null);
    }
  };

  const handleSendAll = async () => {
    if (!needs.length || !suppliers.length) return;
    setSendingAll(true);
    setMessage(null);
    let sent = 0;
    const problems: string[] = [];
    try {
      for (const need of needs) {
        const result = await sendOutreachForNeed(
          outreachDeps,
          String(need._id),
          suppliers.map((s) => String(s._id)),
        );
        sent += result.sent + result.deduped;
        problems.push(...result.errors);
      }
      setMessage(`Sent ${sent} request${sent === 1 ? "" : "s"} across ${needs.length} item${needs.length === 1 ? "" : "s"}${problems.length ? `, ${problems.length} need${problems.length === 1 ? "s" : ""} attention: ${problems[0]}` : ""}`);
    } finally {
      setSendingAll(false);
    }
  };

  const handleReminder = async (threadId: any) => {
    setReminderThread(String(threadId));
    setMessage(null);
    try {
      await sendReminder({ threadId });
      setMessage("Reminder sent in the supplier thread");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not send reminder");
    } finally {
      setReminderThread(null);
    }
  };

  const handleSearch = async () => {
    if (!needId) return;
    setSearching(true);
    setMessage(null);
    try {
      const res = await discover({ needId });
      setResults(res.suppliers);
      setSearchProvider(res.provider);
      setMessage(res.suppliers.length ? `${res.suppliers.length} supplier candidates found via ${res.provider === "exa" ? "Exa" : "Firecrawl"} — add a real contact email to invite one` : "No supplier candidates found for this item");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not search for suppliers");
    } finally {
      setSearching(false);
    }
  };

  return (
    <section>
      <div>
        <div className="text-sm font-semibold">Suppliers</div>
        <div className="mt-1 text-sm text-soft">Add a contact, then approve each request. Nothing is emailed until you do.</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <button onClick={() => setFinding((value) => !value)} className="whitespace-nowrap rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-medium text-ledger hover:bg-paper">
          {finding ? "Hide search" : "Find suppliers"}
        </button>
        <button
          onClick={() => setAdding((value) => !value)}
          className={
            adding || suppliers.length
              ? "whitespace-nowrap rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-medium text-ledger hover:bg-paper"
              : "whitespace-nowrap rounded-lg bg-ledger px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ledger-deep"
          }
        >
          {adding ? "Cancel" : "Add supplier"}
        </button>
      </div>
      {needs.length > 1 && (
        <button
          disabled={!suppliers.length || sendingAll || Boolean(busyId)}
          onClick={() => void handleSendAll()}
          className="mt-2 w-full rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
        >
          {sendingAll ? "Sending…" : `Approve & send all (${needs.length} requests)`}
        </button>
      )}
      {awaitingReply.length > 0 && (
        <div className="mt-3 rounded-lg border border-hairline bg-paper p-2.5 text-[11px] text-soft">
          {awaitingReply.length} of {threads.length} contacted {awaitingReply.length === 1 ? "supplier hasn't" : "suppliers haven't"} replied — nudge anyone quiet below.
        </div>
      )}

      {finding && (
        <div className="mt-4 rounded-lg border border-hairline bg-paper p-3">
          <div className="text-xs text-soft">
            Searches the public web for suppliers of this item (Firecrawl, then Exa if Firecrawl is unavailable). Adding a candidate still needs a real contact email.
            {searchProvider ? ` Last search used ${searchProvider === "exa" ? "Exa" : "Firecrawl"}.` : ""}
          </div>
          <button
            disabled={!needId || searching}
            onClick={() => void handleSearch()}
            className="mt-2 w-full rounded-lg bg-ledger px-3 py-1.5 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
          >
            {searching ? "Searching…" : results ? "Search again" : "Search now"}
          </button>
          {results && (
            <div className="mt-3 space-y-2">
              {results.map((candidate) => (
                <div key={candidate.url} className="rounded-lg border border-hairline bg-sheet p-3">
                  <a href={candidate.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-ledger underline underline-offset-2">{candidate.name}</a>
                  {candidate.snippet && <p className="mt-1 text-[11px] leading-relaxed text-soft">{candidate.snippet}</p>}
                  <button
                    onClick={() => {
                      setPrefill({ name: candidate.name, key: Date.now() });
                      setAdding(true);
                    }}
                    className="mt-2 rounded-lg border border-hairline bg-sheet px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-paper"
                  >
                    Use these details
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {adding && (
        <form
          key={prefill?.key ?? "blank"}
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
              setPrefill(null);
              setMessage("Supplier added; no message sent");
            } catch (cause) {
              setMessage(cause instanceof Error ? cause.message : "Could not add supplier");
            }
          }}
        >
          <input required name="name" aria-label="Supplier name" placeholder="Supplier name" defaultValue={prefill?.name ?? ""} className="input-field" />
          <input required type="email" name="email" aria-label="Supplier email" placeholder="quotes@supplier.org" className="input-field" />
          <input required name="region" aria-label="Supplier region" placeholder="Region or service area" className="input-field" />
          <button className="w-full rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep">Add without sending</button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {suppliers.length === 0 && <div className="rounded-lg border border-dashed border-[#cfc9b8] p-3 text-xs text-soft">No suppliers in this workspace.</div>}
        {suppliers.map((supplier) => {
          const thread = threads.find((row) => row.supplierId === supplier._id);
          const pending = busyId === String(supplier._id);
          const reminding = thread && reminderThread === String(thread._id);
          const canRemind = thread?.status === "sent" && thread.agentmailMessageId;
          return (
            <div key={supplier._id} className="rounded-lg border border-hairline p-3">
              <div className="text-sm font-medium">{supplier.name}</div>
              <div className="mt-0.5 truncate text-[11px] tabular-nums text-soft">{supplier.region}, {supplier.contactEmail}</div>
              <button
                disabled={!needId || pending || Boolean(thread?.agentmailMessageId)}
                onClick={() => void handleSend(supplier._id)}
                className="mt-2 w-full rounded-lg bg-ledger px-2 py-1.5 text-xs font-medium text-white hover:bg-ledger-deep disabled:cursor-not-allowed disabled:bg-[#e7e2d3] disabled:text-soft"
              >
                {pending ? "Sending…" : thread?.agentmailMessageId ? `Request ${thread.status}` : "Approve & send request"}
              </button>
              {canRemind && (
                <button
                  disabled={Boolean(reminding)}
                  onClick={() => void handleReminder(thread._id)}
                  className="mt-1.5 w-full rounded-lg border border-hairline bg-sheet px-2 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
                >
                  {reminding ? "Sending reminder…" : "Send reminder"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {message && <div role="status" className="mt-3 text-xs text-soft">{message}</div>}
    </section>
  );
}
