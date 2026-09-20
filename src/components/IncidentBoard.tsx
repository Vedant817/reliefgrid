import { formatDeadline, deadlineUrgency } from "../lib/format";

const urgencyTone: Record<string, string> = {
  critical: "border-seal bg-[#f9ece7] text-seal",
  warn: "border-[#e7d9ae] bg-[#fbf7ea] text-[#7a5c14]",
  ok: "border-[#bfd9c9] bg-[#eaf2ed] text-ledger",
};

export function IncidentBoard({
  incidents,
  needs,
  activeIncident,
  activeNeed,
  onSelectIncident,
  onSelectNeed,
  search,
  onSearch,
}: any) {
  if (!incidents.length) {
    return (
      <div>
        <div className="font-semibold">No requirements yet</div>
        <div className="mt-1 text-sm text-soft">Create a requirement to start collecting supplier quotes.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onSearch ? (
        <input
          value={search ?? ""}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search requirements…"
          className="input-field"
        />
      ) : null}
      <div className="space-y-1">
        {incidents.map((inc: any) => {
          const isActive = activeIncident?._id === inc._id;
          const urg = deadlineUrgency(inc.deadlineAt);
          return (
            <button
              key={inc._id}
              onClick={() => onSelectIncident(inc._id)}
              className={`w-full rounded-lg px-3 py-2 text-left ${isActive ? "bg-[#eaf2ed]" : "hover:bg-paper"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium leading-tight">{inc.title}</div>
                <span className={`shrink-0 rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold ${urgencyTone[urg]}`}>
                  {formatDeadline(inc.deadlineAt)}
                </span>
              </div>
              {inc.description ? <div className="mt-0.5 line-clamp-1 text-xs text-soft">{inc.description}</div> : null}
            </button>
          );
        })}
      </div>

      {needs.length > 1 ? (
        <div>
          <div className="eyebrow">Line items</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {needs.map((n: any) => {
              const isActive = activeNeed?._id === n._id;
              return (
                <button
                  key={n._id}
                  onClick={() => onSelectNeed(n._id)}
                  className={`rounded-lg border px-3 py-2 text-left ${isActive ? "border-ledger bg-[#eaf2ed]" : "border-hairline bg-sheet hover:border-[#cfc9b8]"}`}
                >
                  <div className="text-sm font-medium leading-tight">{n.item}</div>
                  <div className="mt-0.5 text-xs tabular-nums text-soft">{n.qty} units · {formatDeadline(n.deadlineAt)}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : activeNeed ? (
        <p className="text-sm text-soft">
          {activeNeed.qty} units
          {activeNeed.budgetCents ? ` · $${(activeNeed.budgetCents / 100).toFixed(0)} budget` : ""}
          {activeNeed.certRequired ? ` · ${activeNeed.certRequired}` : ""}
          {activeNeed.deliveryLocation ? ` · ${activeNeed.deliveryLocation}` : ""}
        </p>
      ) : (
        <p className="text-xs text-soft">No line items on this requirement.</p>
      )}
    </div>
  );
}
