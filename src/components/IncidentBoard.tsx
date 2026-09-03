import { formatDate, formatDeadline, deadlineUrgency } from "../lib/format";

export function IncidentBoard({ incidents, needs, activeIncident, activeNeed, onSelectIncident, onSelectNeed }: any) {
  if (!incidents.length) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">◆</div>
        <div className="mt-3 font-semibold">No incidents yet</div>
        <div className="text-sm text-slate-400 mt-1">Click <b>Seed Demo</b> to create the flood-shelter scenario with 100 filters, 3 suppliers and a live allocation.</div>
        <div className="mt-3 text-xs mono text-slate-500">Domain: flood-shelter supplies · NSF/ANSI 53 · synthetic inboxes only</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Incidents</div>
        <span className="text-xs px-2 py-1 rounded-full bg-[#1a2332] border border-[#1e2d4a]">{incidents.length}</span>
      </div>
      <div className="divide-y divide-[#1e2d4a]">
        {incidents.map((inc: any) => {
          const isActive = activeIncident?._id === inc._id;
          const urg = deadlineUrgency(inc.deadlineAt);
          return (
            <button
              key={inc._id}
              onClick={() => onSelectIncident(inc._id)}
              className={`w-full text-left px-4 py-3 hover:bg-[#1a2332] ${isActive ? "bg-[#1a2332]" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-sm leading-tight">{inc.title}</div>
                <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${urg === "critical" ? "bg-red-500/10 text-red-300 border-red-500/20" : urg === "warn" ? "bg-amber-500/10 text-amber-300 border-amber-500/20" : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"}`}>
                  {formatDeadline(inc.deadlineAt)}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1 line-clamp-2">{inc.description}</div>
              <div className="text-[11px] mono text-slate-500 mt-1">{formatDate(inc.createdAt)} · {inc.status}</div>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-[#0f172a] border-t border-[#1e2d4a]">
        <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Needs</div>
        <div className="mt-2 space-y-2">
          {needs.map((n: any) => {
            const isActive = activeNeed?._id === n._id;
            return (
              <button
                key={n._id}
                onClick={() => onSelectNeed(n._id)}
                className={`w-full text-left rounded-xl border p-3 ${isActive ? "bg-white text-[#0a0e1a] border-white" : "bg-[#1a2332] border-[#1e2d4a] text-slate-200"}`}
              >
                <div className="font-medium text-sm leading-tight">{n.item}</div>
                <div className={`text-xs mt-1 ${isActive ? "text-slate-600" : "text-slate-400"}`}>{n.qty} units · ${(n.budgetCents / 100).toFixed(0)} budget · {n.certRequired}</div>
                <div className="mt-2 h-1.5 rounded-full bg-black/10 overflow-hidden">
                  <div className={`h-full ${isActive ? "bg-[#0a0e1a]" : "bg-blue-500"}`} style={{ width: "67%" }} />
                </div>
                <div className={`text-[11px] mono mt-1 ${isActive ? "text-slate-500" : "text-slate-400"}`}>{n.status} · {formatDeadline(n.deadlineAt)}</div>
              </button>
            );
          })}
          {!needs.length && <div className="text-xs text-slate-500">No needs — seed will create the 100-filter need.</div>}
        </div>
      </div>
    </div>
  );
}
