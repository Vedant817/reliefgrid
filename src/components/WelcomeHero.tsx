export function WelcomeHero({ busy, onLoadSample, onCreate }: { busy: boolean; onLoadSample: () => void; onCreate: () => void }) {
  return (
    <section className="card p-6 md:p-8">
      <h1 className="max-w-2xl font-serif text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">
        Turn supplier email into a sourcing decision you can defend
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-soft">
        ReliefGrid compares supplier quotes on price, delivery, and certification, proposes the cheapest workable
        plan, and freezes it the moment the evidence behind it changes. It fits any urgent purchase — a school
        ordering 200 chairs by Friday, a clinic restocking supplies, a relief team buying water filters.
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
        The AI extracts and cites evidence. It never spends money or decides who is eligible — a person always approves.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={onLoadSample}
          disabled={busy}
          className="rounded-lg bg-ledger px-4 py-2 text-sm font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load sample scenario"}
        </button>
        <button
          onClick={onCreate}
          className="rounded-lg border border-hairline bg-sheet px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
        >
          Start from scratch
        </button>
      </div>
      <p className="mt-3 text-[11px] text-soft">The sample is clearly labeled synthetic demo data in your private workspace.</p>
    </section>
  );
}
