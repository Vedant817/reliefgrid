import { demoProgress } from "../lib/outreach";

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
  const { steps, nextIndex } = demoProgress({ hasNeed, threadCount, offerCount, verifiedOfferCount, planStatus });

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Sample scenario</div>
          <div className="mt-1 text-[11px] text-soft">Derived from persisted records</div>
        </div>
        <button onClick={onReset} disabled={busy} className="rounded-lg border border-ledger/40 bg-[#eaf2ed] px-3 py-1.5 text-xs font-semibold text-ledger hover:bg-[#dcebe2] disabled:opacity-50">
          {busy ? "Reloading..." : "Reload sample"}
        </button>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li key={step.label} className={`flex gap-3 rounded-lg border px-3 py-2.5 ${isNext ? "border-ledger/40 bg-[#eaf2ed]" : "border-hairline bg-sheet"}`}>
              <span className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${step.complete ? "bg-ledger text-white" : isNext ? "bg-ink text-paper" : "bg-[#e7e2d3] text-soft"}`}>
                {step.complete ? "✓" : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{step.label}</span>
                <span className="block truncate text-[11px] tabular-nums text-soft">{step.evidence}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {nextIndex < 0 && <div className="mt-3 text-xs font-medium text-ledger">Demo complete. Reset is safe to repeat.</div>}
      <details className="mt-3 rounded-lg border border-dashed border-[#cfc9b8] bg-sheet px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-soft">
          Recorded fixture <span className="rounded-[4px] border border-[#e7d9ae] bg-[#fbf7ea] px-1.5 py-0.5 font-serif italic text-[#7a5c14]">fixture</span>
          <span className="text-soft"> — offline reference only, not live proof</span>
        </summary>
        <div className="mt-2 text-[11px] tabular-nums leading-relaxed text-soft">
          Canonical: 100/100, $1,070 (Casa 30 + Apex 70), recall shortfall 30/100, replacement 100/100, +16h counterfactual saves $170.
          Live values above come from persisted records; see <span className="text-ink">fixtures/demo-scenario.json</span>.
        </div>
      </details>
    </section>
  );
}
