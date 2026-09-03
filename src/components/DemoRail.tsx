type DemoRailProps = {
  hasNeed: boolean;
  threadCount: number;
  offerCount: number;
  verifiedOfferCount: number;
  planStatus?: string;
  busy: boolean;
  onReset: () => void;
};

export function DemoRail({ hasNeed, threadCount, offerCount, verifiedOfferCount, planStatus, busy, onReset }: DemoRailProps) {
  const steps = [
    { label: "Create need", complete: hasNeed, evidence: hasNeed ? "need persisted" : "waiting" },
    { label: "Send RFQs", complete: threadCount > 0, evidence: `${threadCount} threads` },
    { label: "Receive replies", complete: offerCount > 0, evidence: `${offerCount} offers` },
    {
      label: "Verify evidence",
      complete: offerCount > 0 && verifiedOfferCount === offerCount,
      evidence: `${verifiedOfferCount}/${offerCount} verified`,
    },
    { label: "Human approval", complete: planStatus === "approved", evidence: planStatus ?? "no plan" },
  ];
  const nextIndex = steps.findIndex((step) => !step.complete);

  return (
    <section className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Judge mode</div>
          <div className="text-[11px] text-slate-500 mt-1">Derived from persisted records</div>
        </div>
        <button onClick={onReset} disabled={busy} className="px-3 py-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 text-xs font-semibold disabled:opacity-50">
          {busy ? "Resetting..." : "Reset Demo"}
        </button>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li key={step.label} className={`flex gap-3 rounded-xl border px-3 py-2.5 ${isNext ? "border-cyan-400/40 bg-cyan-400/10" : "border-[#1e2d4a] bg-[#1a2332]"}`}>
              <span className={`mt-0.5 w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold ${step.complete ? "bg-emerald-400 text-[#07120e]" : isNext ? "bg-cyan-400 text-[#06131a]" : "bg-slate-700 text-slate-400"}`}>
                {step.complete ? "OK" : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{step.label}</span>
                <span className="block text-[11px] text-slate-500 mono truncate">{step.evidence}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {nextIndex < 0 && <div className="mt-3 text-xs text-emerald-300">Demo complete. Reset is safe to repeat.</div>}
    </section>
  );
}
