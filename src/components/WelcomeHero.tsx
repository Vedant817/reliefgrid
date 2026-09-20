export function WelcomeHero({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="card mx-auto flex h-full max-w-[1400px] items-center overflow-y-auto">
      <div className="w-full px-6 py-8 sm:px-10 lg:px-16">
        <div className="max-w-3xl">
          <div className="eyebrow text-ledger">Start a sourcing workspace</div>
          <h1 className="mt-3 font-serif text-[34px] font-bold leading-[1.05] tracking-tight sm:text-[44px] lg:text-[52px]">
            One requirement.<br className="hidden sm:block" /> One defensible decision.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-soft">
            Define what must arrive, where, and by when. ReliefGrid then keeps supplier outreach, comparable quotes,
            evidence, and approval in one live workspace.
          </p>
        </div>

        <div className="mt-8 border-y border-hairline py-4 text-sm text-soft">
          <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0">
            <li className="flex flex-1 items-center gap-3 sm:border-r sm:border-hairline sm:pr-5">
              <span className="font-serif text-xl font-bold text-ledger">01</span><span>Define the requirement</span>
            </li>
            <li className="flex flex-1 items-center gap-3 sm:border-r sm:border-hairline sm:px-5">
              <span className="font-serif text-xl font-bold text-ledger">02</span><span>Collect comparable offers</span>
            </li>
            <li className="flex flex-1 items-center gap-3 sm:pl-5">
              <span className="font-serif text-xl font-bold text-ledger">03</span><span>Review and approve</span>
            </li>
          </ol>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <button
            onClick={onCreate}
            className="rounded-lg bg-ledger px-5 py-3 text-sm font-semibold text-white hover:bg-ledger-deep focus:outline-none focus:ring-2 focus:ring-ledger/30 focus:ring-offset-2"
          >
            Create a requirement
          </button>
          <p className="text-xs text-soft">Nothing is sent until you approve supplier outreach.</p>
        </div>
      </div>
    </section>
  );
}
