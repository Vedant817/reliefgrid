export function WelcomeHero({
  onCreate,
  signedIn,
}: {
  onCreate?: () => void;
  signedIn?: boolean;
}) {
  return (
    <section className="card mx-auto flex h-full max-w-[1400px] items-center overflow-y-auto">
      <div className="w-full px-6 py-8 sm:px-10 lg:px-16">
        <div className="max-w-3xl">
          <div className="eyebrow text-ledger">Start a purchase</div>
          <h1 className="mt-3 font-serif text-[34px] font-bold leading-[1.05] tracking-tight sm:text-[44px] lg:text-[52px]">
            You need it by Friday.<br className="hidden sm:block" /> Paste the quote emails. Approve the buy.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-soft">
            ReliefGrid turns supplier quote emails into comparable offers, checks evidence, and asks you to approve
            the plan. It never sends mail or spends money on its own.
          </p>
        </div>

        <div className="mt-8 border-y border-hairline py-4 text-sm text-soft">
          <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-0">
            <li className="flex flex-1 items-center gap-3 sm:border-r sm:border-hairline sm:pr-4">
              <span className="font-serif text-xl font-bold text-ledger">01</span><span>Requirement</span>
            </li>
            <li className="flex flex-1 items-center gap-3 sm:border-r sm:border-hairline sm:px-4">
              <span className="font-serif text-xl font-bold text-ledger">02</span><span>Shortlist</span>
            </li>
            <li className="flex flex-1 items-center gap-3 sm:border-r sm:border-hairline sm:px-4">
              <span className="font-serif text-xl font-bold text-ledger">03</span><span>Quotes</span>
            </li>
            <li className="flex flex-1 items-center gap-3 sm:pl-4">
              <span className="font-serif text-xl font-bold text-ledger">04</span><span>Decide</span>
            </li>
          </ol>
        </div>

        {signedIn && onCreate ? (
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button
              onClick={onCreate}
              className="rounded-lg bg-ledger px-5 py-3 text-sm font-semibold text-white hover:bg-ledger-deep focus:outline-none focus:ring-2 focus:ring-ledger/30 focus:ring-offset-2"
            >
              Create a requirement
            </button>
            <p className="text-xs text-soft">Nothing is sent until you approve supplier outreach.</p>
          </div>
        ) : (
          <p className="mt-7 text-xs text-soft">
            Sign in to open a private workspace with a starter vendor directory. Requirements and quotes remain private
            to the account.
          </p>
        )}
      </div>
    </section>
  );
}
