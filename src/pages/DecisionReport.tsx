import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents, formatDate, humanizeStatus, displayApprover } from "../lib/format";

// Exportable one-page decision report: what was requested, who quoted what,
// why the winner won, who approved, and the evidence behind it. Opens from
// the decision summary and prints cleanly to PDF for forwarding to a boss
// or an auditor.
export function DecisionReport() {
  const needId = new URLSearchParams(window.location.search).get("needId");
  const workspace: any = useQuery(api.workspace.getNeedWorkspace, needId ? { needId: needId as any } : "skip");
  const need: any = workspace?.need;
  const offers: any[] = workspace?.offers ?? [];
  const plan: any = workspace?.latestPlan;
  const checks: any[] = offers.flatMap((o: any) => o.sourceChecks ?? []);
  const whatif: any = useQuery(
    api.counterfactual.compareConstraints,
    needId ? { needId: needId as any, deadlineExtensionHours: 0 } : "skip",
  );
  const timeline: any = useQuery(api.replay.listTimeline, need?.incidentId ? { incidentId: need.incidentId } : "skip") ?? [];

  if (!needId) {
    return <main className="mx-auto max-w-3xl bg-paper p-8 text-sm text-soft">Missing request reference.</main>;
  }
  if (!need || !plan) {
    return <main className="mx-auto max-w-3xl bg-paper p-8 text-sm text-soft">Loading decision report…</main>;
  }

  // Workspace order is canonical: the printable record ranks winners
  // exactly as the live matrix does.
  const sorted = offers;
  const winners = new Set((plan.lines ?? []).map((l: any) => String(l.offerId)));
  const approverLabel = displayApprover(plan.approval?.approvedBy);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink pb-6">
          <div>
            <div className="text-[13px] font-semibold text-ledger">ReliefGrid decision report</div>
            <h1 className="mt-2 font-serif text-[32px] font-bold leading-tight tracking-tight">{need.item} — {need.qty} units</h1>
            <p className="mt-2 text-xs tabular-nums text-soft">Drawn up {new Date().toLocaleString()}, approved by {approverLabel}</p>
          </div>
          <button onClick={() => window.print()} className="no-print shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90">
            Print / PDF
          </button>
        </div>

        <section className="mt-8">
          <h2 className="eyebrow">What was requested</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="border-b border-hairline pb-2"><dt className="text-soft">Budget</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatCents(need.budgetCents)}</dd></div>
            <div className="border-b border-hairline pb-2"><dt className="text-soft">Required by</dt><dd className="mt-0.5 font-semibold">{formatDate(need.deadlineAt)}</dd></div>
            <div className="border-b border-hairline pb-2"><dt className="text-soft">Certification</dt><dd className="mt-0.5 font-semibold">{need.certRequired ?? "—"}</dd></div>
            <div className="border-b border-hairline pb-2"><dt className="text-soft">Delivery</dt><dd className="mt-0.5 font-semibold">{need.deliveryLocation ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="mt-8">
          <h2 className="eyebrow">Who quoted what</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left text-xs text-soft">
                <th className="py-2 pr-3 font-medium">Supplier</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th>
                <th className="py-2 pr-3 text-right font-medium">Unit</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Arrival</th>
                <th className="py-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sorted.map((o: any) => (
                <tr key={o._id} className={winners.has(String(o._id)) ? "bg-[#eaf2ed]/60" : undefined}>
                  <td className="py-2.5 pr-3 font-semibold">{o.supplier?.name ?? "Unknown supplier"}{winners.has(String(o._id)) ? " ✓" : ""}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{o.qty}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatCents(o.unitPriceCents)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatCents(o.qty * o.unitPriceCents)}</td>
                  <td className="py-2.5 pr-3 text-xs">{formatDate(o.arrivalAt)}</td>
                  <td className="py-2.5 text-xs text-soft">{humanizeStatus(o.certStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-8">
          <h2 className="eyebrow">Why this won</h2>
          <p className="mt-2 font-serif text-[19px] leading-snug">
            {formatCents(plan.totalCostCents)} for {plan.totalQty} of {need.qty} units — the lowest-cost mix meeting
            the deadline{need.certRequired ? ` and ${need.certRequired} certification` : ""}.
          </p>
          {whatif?.baseline?.rejected?.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-soft">
              {whatif.baseline.rejected.map((r: any) => (
                <li key={r.offerId}>{r.supplierName}: {r.reason}</li>
              ))}
            </ul>
          )}
          {plan.decisionTrace && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-sheet p-3 text-[11px] tabular-nums leading-relaxed text-soft ring-1 ring-hairline">{plan.decisionTrace}</pre>}
        </section>

        <section className="mt-8">
          <h2 className="eyebrow">Evidence cited</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {checks.map((c: any) => (
              <li key={c._id} className="rounded-lg bg-sheet p-3 ring-1 ring-hairline">
                <div className="text-xs font-semibold">{c.type}: {humanizeStatus(c.status)}, {c.sourceAuthority ?? "supporting"}</div>
                <div className="mt-1 font-serif text-[15px] italic leading-relaxed">“{c.quote}”</div>
                <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ledger underline underline-offset-2">{c.url}</a>
              </li>
            ))}
            {offers.flatMap((o: any) => (o.attachments ?? []).map((a: any) => ({ ...a, supplierName: o.supplier?.name ?? "Unknown supplier" }))).map((a: any) => (
              <li key={a._id} className="rounded-lg bg-sheet p-3 ring-1 ring-hairline">
                <div className="text-xs font-semibold">Supplier file, {a.supplierName}</div>
                <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ledger underline underline-offset-2">{a.name}</a>
              </li>
            ))}
            {!checks.length && <li className="text-sm text-soft">No independent source checks recorded.</li>}
          </ul>
        </section>

        <section className="mt-8 border-t-2 border-ink pt-6">
          <h2 className="eyebrow">History</h2>
          <ol className="mt-2 space-y-1 text-sm text-soft">
            {timeline.map((event: any, i: number) => (
              <li key={event._id}><span className="tabular-nums">{String(i + 1).padStart(2, "0")}</span>, {event.action.replaceAll("_", " ")}</li>
            ))}
            {!timeline.length && <li>Nothing recorded yet.</li>}
          </ol>
          <p className="mt-6 font-serif text-[15px] italic text-soft">Signed {new Date().toLocaleDateString()} — {approverLabel}, ReliefGrid workspace record.</p>
        </section>
      </div>
    </main>
  );
}
