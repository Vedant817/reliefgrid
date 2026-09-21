import { useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { awaitingReplyThreads, sendOutreachForNeed } from "../lib/outreach";
import { userFacingError } from "../lib/errors";

type DiscoveredSupplier = {
  name: string;
  url: string;
  snippet: string;
  contactEmail?: string;
  region: string;
};

type SupplierPrefill = { name: string; email: string; region: string; key: number };

export function SupplierOutreach({ needId, suppliers, threads }: { needId?: any; suppliers: any[]; threads: any[] }) {
  const upsertSupplier = useMutation(api.suppliers.upsertSupplier);
  const createThreads = useMutation(api.rfq.createRfqThreadsForNeed);
  const ensureInbox = useAction(api.actions.inboxes.ensureInboxForNeed);
  const sendRfq = useAction(api.actions.sendRfq.approveAndSendRfq);
  const sendReminder = useAction(api.actions.sendReminder.sendReminder);
  const discover = useAction(api.actions.discoverSuppliers.discoverSuppliers);
  const [adding, setAdding] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reminderThread, setReminderThread] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredSupplier[] | null>(null);
  const [searchProvider, setSearchProvider] = useState<"firecrawl" | "exa" | null>(null);
  const [prefill, setPrefill] = useState<SupplierPrefill | null>(null);
  const [shortlistingUrl, setShortlistingUrl] = useState<string | null>(null);

  const threadSupplierIds = useMemo(() => new Set(threads.map((thread) => String(thread.supplierId))), [threads]);
  const shortlisted = suppliers.filter((supplier) => threadSupplierIds.has(String(supplier._id)));
  const saved = suppliers.filter((supplier) => !threadSupplierIds.has(String(supplier._id)));
  const pendingRealSuppliers = shortlisted.filter((supplier) => !supplier.isDemo && !threads.find((thread) => thread.supplierId === supplier._id)?.agentmailMessageId);
  const awaitingReply = awaitingReplyThreads(threads);

  const outreachDeps = {
    ensureInbox: (id: string) => ensureInbox({ needId: id as any }),
    createThreads: (id: string, supplierIds: string[]) => createThreads({ needId: id as any, supplierIds: supplierIds as any }) as unknown as Promise<Array<{ _id: string }>>,
    sendRfq: (threadId: string) => sendRfq({ threadId: threadId as any }),
  };

  const addToShortlist = async (supplierId: any) => {
    if (!needId) return;
    await createThreads({ needId, supplierIds: [supplierId] });
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
      setMessage(userFacingError(cause, "Could not send request"));
    } finally {
      setBusyId(null);
    }
  };

  const handleSendAll = async () => {
    if (!needId || !pendingRealSuppliers.length) return;
    setSendingAll(true);
    setMessage(null);
    try {
      const result = await sendOutreachForNeed(outreachDeps, String(needId), pendingRealSuppliers.map((supplier) => String(supplier._id)));
      const total = result.sent + result.deduped;
      setMessage(result.errors.length
        ? `${total} request${total === 1 ? "" : "s"} sent or already tracked; ${result.errors.length} need attention: ${result.errors[0]}`
        : `${total} supplier request${total === 1 ? "" : "s"} sent and tracked`);
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
      setMessage(userFacingError(cause, "Could not send reminder"));
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
      setMessage(res.suppliers.length
        ? `${res.suppliers.length} matching suppliers found via ${res.provider === "exa" ? "Exa" : "Firecrawl"}`
        : "No matching suppliers found. Try a saved vendor or add one manually.");
    } catch (cause) {
      setMessage(userFacingError(cause, "Could not search for suppliers"));
    } finally {
      setSearching(false);
    }
  };

  const handleCandidate = async (candidate: DiscoveredSupplier) => {
    if (!candidate.contactEmail) {
      setPrefill({ name: candidate.name, email: "", region: candidate.region, key: Date.now() });
      setAdding(true);
      return;
    }
    setShortlistingUrl(candidate.url);
    setMessage(null);
    try {
      const supplierId = await upsertSupplier({ name: candidate.name, contactEmail: candidate.contactEmail, region: candidate.region });
      await addToShortlist(supplierId);
      setMessage(`${candidate.name} added to this requirement. No email sent.`);
    } catch (cause) {
      setMessage(userFacingError(cause, "Could not add supplier to shortlist"));
    } finally {
      setShortlistingUrl(null);
    }
  };

  return (
    <section>
      <div className="rounded-[12px] border border-[#b7cec1] bg-[#eef4f0] p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ledger">Build the shortlist</div>
        <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-ink">Start with matched vendors, not a blank contact form.</h2>
        <p className="mt-1 text-sm leading-relaxed text-soft">
          Search the public web for suppliers and public sales contacts. Review the source before adding anyone; nothing is emailed yet.
        </p>
        <button disabled={!needId || searching} onClick={() => void handleSearch()} className="mt-3 w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-semibold text-white hover:bg-ledger-deep disabled:opacity-50">
          {searching ? "Finding matching suppliers…" : results ? "Refresh supplier matches" : "Find matching suppliers"}
        </button>
        {searchProvider ? <p className="mt-2 text-[11px] text-soft">Latest search: {searchProvider === "exa" ? "Exa" : "Firecrawl"}</p> : null}
      </div>

      {results ? (
        <div className="mt-4 space-y-2" aria-label="Supplier matches">
          {results.map((candidate) => {
            const alreadyShortlisted = candidate.contactEmail
              ? shortlisted.some((supplier) => supplier.contactEmail.toLowerCase() === candidate.contactEmail?.toLowerCase())
              : false;
            return (
              <article key={candidate.url} className="rounded-[10px] border border-hairline bg-sheet p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={candidate.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-ledger underline decoration-[#9db5a8] underline-offset-2">{candidate.name}</a>
                    <p className="mt-1 text-[11px] leading-relaxed text-soft">{candidate.snippet || candidate.region}</p>
                  </div>
                  <span className={`shrink-0 rounded-[4px] border px-2 py-0.5 text-[10px] font-semibold ${candidate.contactEmail ? "border-[#b7cec1] bg-[#eef4f0] text-ledger" : "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]"}`}>
                    {candidate.contactEmail ? "Contact found" : "Contact needed"}
                  </span>
                </div>
                {candidate.contactEmail ? <div className="mt-2 text-xs tabular-nums text-ink">{candidate.contactEmail}</div> : null}
                <button disabled={alreadyShortlisted || shortlistingUrl === candidate.url} onClick={() => void handleCandidate(candidate)} className="mt-3 w-full rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-semibold text-ink hover:bg-paper disabled:cursor-not-allowed disabled:text-soft">
                  {alreadyShortlisted ? "Already shortlisted" : shortlistingUrl === candidate.url ? "Adding…" : candidate.contactEmail ? "Add to shortlist" : "Add contact details"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button onClick={() => setShowSaved((value) => !value)} className="flex-1 rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-medium text-ink hover:bg-paper">
          {showSaved ? "Hide saved vendors" : `Use saved vendors${saved.length ? ` (${saved.length})` : ""}`}
        </button>
        <button onClick={() => { setPrefill(null); setAdding((value) => !value); }} className="flex-1 rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-medium text-ink hover:bg-paper">
          {adding ? "Cancel manual entry" : "Add manually"}
        </button>
      </div>

      {showSaved ? (
        <div className="mt-3 space-y-2 rounded-[10px] border border-hairline bg-paper p-3">
          <div className="text-xs font-semibold text-ink">Saved vendor directory</div>
          {saved.length ? saved.map((supplier) => (
            <div key={supplier._id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-sheet p-2.5">
              <div className="min-w-0"><div className="flex items-center gap-2"><div className="truncate text-xs font-semibold">{supplier.name}</div>{supplier.isDemo ? <span className="rounded bg-[#fbf7ea] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7a5c14]">Demo</span> : null}</div><div className="truncate text-[11px] text-soft">{supplier.isDemo ? supplier.region : supplier.contactEmail}</div></div>
              <button onClick={() => void addToShortlist(supplier._id).then(() => setMessage(`${supplier.name} added to this requirement. No email sent.`)).catch((cause) => setMessage(userFacingError(cause, "Could not add saved vendor")))} className="shrink-0 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] font-medium text-ledger hover:bg-paper">Shortlist</button>
            </div>
          )) : <p className="text-xs text-soft">No saved vendors yet.</p>}
        </div>
      ) : null}

      {adding ? (
        <form key={prefill?.key ?? "blank"} className="mt-3 space-y-2 rounded-[10px] border border-hairline bg-paper p-3" onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setMessage(null);
          try {
            const supplierId = await upsertSupplier({ name: String(form.get("name")), contactEmail: String(form.get("email")), region: String(form.get("region")) });
            await addToShortlist(supplierId);
            setAdding(false);
            setPrefill(null);
            setMessage("Supplier added to this requirement. No email sent.");
          } catch (cause) {
            setMessage(userFacingError(cause, "Could not add supplier"));
          }
        }}>
          <div className="text-xs font-semibold text-ink">Manual supplier</div>
          <input required name="name" aria-label="Supplier name" placeholder="Supplier name" defaultValue={prefill?.name ?? ""} className="input-field" />
          <input required type="email" name="email" aria-label="Supplier email" placeholder="quotes@supplier.org" defaultValue={prefill?.email ?? ""} className="input-field" />
          <input required name="region" aria-label="Supplier region" placeholder="Region or service area" defaultValue={prefill?.region ?? ""} className="input-field" />
          <button className="w-full rounded-lg bg-ledger px-3 py-2 text-xs font-semibold text-white hover:bg-ledger-deep">Add to shortlist</button>
        </form>
      ) : null}

      <div className="mt-6 flex items-end justify-between gap-3 border-b border-hairline pb-2">
        <div><div className="text-sm font-semibold">Shortlist for this requirement</div><div className="mt-0.5 text-xs text-soft">Review contacts before approving outreach.</div></div>
        <div className="text-xs tabular-nums text-soft">{shortlisted.length} selected</div>
      </div>

      {awaitingReply.length > 0 ? <div className="mt-3 rounded-lg border border-hairline bg-paper p-2.5 text-[11px] text-soft">{awaitingReply.length} contacted {awaitingReply.length === 1 ? "supplier hasn't" : "suppliers haven't"} replied yet.</div> : null}

      <div className="mt-3 space-y-2">
        {shortlisted.length === 0 ? <div className="rounded-lg border border-dashed border-[#cfc9b8] p-4 text-sm text-soft">No suppliers shortlisted yet. Find matches above or reuse a saved vendor.</div> : shortlisted.map((supplier) => {
          const thread = threads.find((row) => row.supplierId === supplier._id);
          const pending = busyId === String(supplier._id);
          const reminding = thread && reminderThread === String(thread._id);
          const canRemind = thread?.status === "sent" && thread.agentmailMessageId;
          return (
            <div key={supplier._id} className="rounded-lg border border-hairline bg-sheet p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex items-center gap-2"><div className="truncate text-sm font-medium">{supplier.name}</div>{supplier.isDemo ? <span className="rounded bg-[#fbf7ea] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7a5c14]">Demo</span> : null}</div><div className="mt-0.5 truncate text-[11px] tabular-nums text-soft">{supplier.region} · {supplier.isDemo ? "pasted quotes only" : supplier.contactEmail}</div></div>
                <span className="rounded-[4px] bg-paper px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-soft">{thread?.agentmailMessageId ? thread.status : "Ready"}</span>
              </div>
              <button disabled={!needId || supplier.isDemo || pending || Boolean(thread?.agentmailMessageId)} onClick={() => void handleSend(supplier._id)} className="mt-2 w-full rounded-lg border border-hairline bg-sheet px-2 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:cursor-not-allowed disabled:text-soft">
                {supplier.isDemo ? "Demo contact — paste a quote" : pending ? "Sending…" : thread?.agentmailMessageId ? "Request sent" : "Send only this request"}
              </button>
              {canRemind ? <button disabled={Boolean(reminding)} onClick={() => void handleReminder(thread._id)} className="mt-1.5 w-full rounded-lg border border-hairline bg-sheet px-2 py-1.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50">{reminding ? "Sending reminder…" : "Send reminder"}</button> : null}
            </div>
          );
        })}
      </div>

      {pendingRealSuppliers.length ? (
        <button disabled={sendingAll || Boolean(busyId)} onClick={() => void handleSendAll()} className="mt-3 w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-semibold text-white hover:bg-ledger-deep disabled:opacity-50">
          {sendingAll ? "Sending approved requests…" : `Approve & send shortlist (${pendingRealSuppliers.length})`}
        </button>
      ) : shortlisted.some((supplier) => supplier.isDemo && !threads.find((thread) => thread.supplierId === supplier._id)?.agentmailMessageId) ? <div className="mt-3 rounded-lg border border-[#e7d9ae] bg-[#fbf7ea] p-3 text-xs text-[#7a5c14]">Demo suppliers never receive external email. Continue to Quotes and paste a sample response.</div> : null}

      {message ? <div role="status" className="mt-3 rounded-lg border border-hairline bg-paper p-3 text-xs text-soft">{message}</div> : null}
    </section>
  );
}
