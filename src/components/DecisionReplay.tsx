import { Component, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatCents } from "../lib/format";

export class ReplayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <section className="rounded-2xl bg-[#111827] border border-red-500/30 p-5 text-sm text-red-200">
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
    <section className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d4a] flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Decision time machine</div>
          <div className="text-[11px] text-slate-500 mt-1">Append-only event snapshots · deterministic replay</div>
        </div>
        <span className="text-[10px] mono px-2 py-1 rounded-full border border-violet-400/20 bg-violet-400/10 text-violet-300">EVENT v1</span>
      </div>
      <div className="p-5 grid lg:grid-cols-[1fr_2fr] gap-6">
        <div>
          <label className="text-xs font-semibold flex justify-between gap-3">
            Historical event <span className="mono text-violet-300">{timeline.length ? `${index + 1}/${timeline.length}` : "0/0"}</span>
          </label>
          <input
            type="range"
            min="0"
            max={Math.max(0, timeline.length - 1)}
            value={index}
            disabled={timeline.length < 2}
            onChange={(event) => setSelected(Number(event.target.value))}
            className="w-full mt-4 accent-violet-400"
          />
          <div className="mt-4 space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {timeline.map((event: any, eventIndex: number) => (
              <button key={event._id} onClick={() => setSelected(eventIndex)} className={`w-full text-left rounded-lg px-3 py-2 border text-xs ${eventIndex === index ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-[#1e2d4a] text-slate-400"}`}>
                <span className="mono">{String(eventIndex + 1).padStart(2, "0")}</span> · {event.action.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-[#0f172a] border border-[#1e2d4a] p-4 min-h-44">
          {!snapshot ? <div className="text-sm text-slate-500">Reset Demo to create replayable events.</div> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{snapshot.need?.item}</div>
                <div className="text-xs mono text-slate-500">{replay.event.action}</div>
              </div>
              {snapshot.causalDiff && <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-200">{snapshot.causalDiff}</div>}
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Offers at event</div>
                  <div className="mt-2 space-y-1">
                    {snapshot.offers?.map((offer: any) => (
                      <div key={offer.supplier} className="text-xs flex justify-between gap-2"><span>{offer.supplier}</span><span className="mono text-slate-400">{offer.qty} · {offer.certStatus}</span></div>
                    ))}
                    {!snapshot.offers?.length && <div className="text-xs text-slate-500">No replies yet</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Plan at event</div>
                  {snapshot.plan ? (
                    <div className="mt-2">
                      <div className="text-2xl font-bold">{snapshot.plan.coverage ?? "?"} / {snapshot.need?.qty ?? "?"}</div>
                      <div className="text-xs text-slate-400">{formatCents(snapshot.plan.costCents ?? 0)} · {(snapshot.plan.suppliers ?? []).join(" + ") || "no suppliers recorded"}</div>
                    </div>
                  ) : <div className="mt-2 text-xs text-slate-500">Not computed</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
