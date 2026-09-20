import { Component, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents } from "../lib/format";

// Audit snapshots record the raw approver identity; the history view shows
// the human role instead.
function formatCausalDiff(diff: string) {
  return diff.replace(/Plan approved by [^;|]*\|[^;]*;/, "Plan approved;");
}

export class ReplayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <section className="rounded-[10px] border border-[#edc4b6] bg-[#f9ece7] p-5 text-sm text-seal">
          Replay unavailable for this event — the audit trail continues below in the timeline.
        </section>
      );
    }
    return this.props.children;
  }
}

export function DecisionReplay({ incidentId }: { incidentId?: any }) {
  const timeline = useQuery(api.replay.listTimeline, incidentId ? { incidentId } : "skip") ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const index = Math.min(selected ?? Math.max(0, timeline.length - 1), Math.max(0, timeline.length - 1));
  const eventId = timeline[index]?._id;
  const replay = useQuery(api.replay.getIncidentAt, eventId ? { eventId } : "skip");
  const snapshot = replay?.snapshot;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div>
          <div className="eyebrow">Decision history</div>
          <div className="mt-1 text-[11px] text-soft">Every change, in order</div>
        </div>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_2fr]">
        <div>
          <div className="text-xs font-semibold">
            History <span className="font-normal tabular-nums text-ledger">{timeline.length ? `${index + 1}/${timeline.length}` : "0/0"}</span>
          </div>
          <div className="mt-4 max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {timeline.map((event: any, eventIndex: number) => (
              <button key={event._id} onClick={() => setSelected(eventIndex)} className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${eventIndex === index ? "border-ledger bg-[#eaf2ed] font-medium text-ledger-deep" : "border-hairline text-soft hover:bg-paper"}`}>
                <span className="tabular-nums">{String(eventIndex + 1).padStart(2, "0")}</span>, {event.action.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-44 rounded-xl border border-hairline bg-paper p-4">
          {!snapshot ? <div className="text-sm text-soft">No replayable decision snapshot has been recorded yet.</div> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{snapshot.need?.item}</div>
                <div className="text-xs tabular-nums text-soft">{replay.event.action}</div>
              </div>
              {snapshot.causalDiff && <div className="mt-3 rounded-lg border border-[#edc4b6] bg-[#f9ece7] p-3 text-sm text-seal">{formatCausalDiff(snapshot.causalDiff)}</div>}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-[10px] font-medium text-soft">Offers at event</div>
                  <div className="mt-2 space-y-1">
                    {snapshot.offers?.map((offer: any) => (
                      <div key={offer.supplier} className="flex justify-between gap-2 text-xs"><span>{offer.supplier}</span><span className="tabular-nums text-soft">{offer.qty}, {offer.certStatus}</span></div>
                    ))}
                    {!snapshot.offers?.length && <div className="text-xs text-soft">No replies yet</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-soft">Plan at event</div>
                  {snapshot.plan ? (
                    <div className="mt-2">
                      <div className="font-serif text-2xl font-bold tabular-nums">{snapshot.plan.coverage ?? "?"} / {snapshot.need?.qty ?? "?"}</div>
                      <div className="text-xs tabular-nums text-soft">{formatCents(snapshot.plan.costCents ?? 0)}, {(snapshot.plan.suppliers ?? []).join(" + ") || "no suppliers recorded"}</div>
                    </div>
                  ) : <div className="mt-2 text-xs text-soft">Not computed</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
