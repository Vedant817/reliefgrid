import { formatDate, formatDeadline, deadlineUrgency, humanizeStatus } from "../lib/format";

const urgencyTone: Record<string, string> = {
  critical: "border-seal bg-[#f9ece7] text-seal",
  warn: "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]",
  ok: "border-[#bfd9c9] bg-[#eaf2ed] text-ledger",
};

export function IncidentBoard({ incidents, needs, activeIncident, activeNeed, onSelectIncident, onSelectNeed }: any) {
  if (!incidents.length) {
    return (
      <div className="card p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-paper text-soft">◆</div>
        <div className="mt-3 font-semibold">No incidents yet</div>
        <div className="mt-1 text-sm text-soft">Create an urgent requirement to prepare supplier outreach and a defensible sourcing plan.</div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="eyebrow">Incidents</div>
        <span className="rounded-md border border-hairline bg-paper px-2 py-0.5 text-xs font-medium tabular-nums text-soft">{incidents.length}</span>
      </div>
      <div className="divide-y divide-hairline">
        {incidents.map((inc: any) => {
          const isActive = activeIncident?._id === inc._id;
          const urg = deadlineUrgency(inc.deadlineAt);
          return (
            <button
              key={inc._id}
              onClick={() => onSelectIncident(inc._id)}
              className={`w-full px-4 py-3 text-left hover:bg-paper ${isActive ? "bg-[#f1efe7]" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium leading-tight">{inc.title}</div>
                <span className={`shrink-0 rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold ${urgencyTone[urg]}`}>
                  {formatDeadline(inc.deadlineAt)}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-soft">{inc.description}</div>
              <div className="mt-1 text-[11px] tabular-nums text-soft">{formatDate(inc.createdAt)}, {humanizeStatus(inc.status)}</div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-hairline bg-paper px-4 py-3">
        <div className="eyebrow">Needs</div>
        <div className="mt-2 space-y-2">
          {needs.map((n: any) => {
            const isActive = activeNeed?._id === n._id;
            return (
              <button
                key={n._id}
                onClick={() => onSelectNeed(n._id)}
                className={`w-full rounded-lg border p-3 text-left ${isActive ? "border-ledger bg-[#eaf2ed]" : "border-hairline bg-sheet hover:border-[#cfc9b8]"}`}
              >
                <div className="text-sm font-medium leading-tight">{n.item}</div>
                <div className="mt-1 text-xs tabular-nums text-soft">{n.qty} units, ${(n.budgetCents / 100).toFixed(0)} budget, {n.certRequired}</div>
                <div className="mt-1 text-[11px] tabular-nums text-soft">{humanizeStatus(n.status)}, {formatDeadline(n.deadlineAt)}</div>
              </button>
            );
          })}
          {!needs.length && <div className="text-xs text-soft">No requirements have been added to this incident.</div>}
        </div>
      </div>
    </div>
  );
}
