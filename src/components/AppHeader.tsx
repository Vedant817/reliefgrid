import type { ReactNode } from "react";

type AppHeaderProps = {
  subtitle?: string;
  email?: string | null;
  onSignOut?: () => void;
  children?: ReactNode;
  narrow?: boolean;
};

export function AppHeader({ subtitle, email, onSignOut, children, narrow }: AppHeaderProps) {
  return (
    <header className="z-40 shrink-0 border-b border-hairline bg-sheet">
      <div className={`mx-auto flex h-16 items-center justify-between gap-4 px-4 lg:px-6 ${narrow ? "max-w-[800px]" : "max-w-[1400px]"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ledger font-serif text-[18px] font-bold text-white">R</div>
          <div className="min-w-0">
            <div className="font-serif text-[19px] font-bold leading-none tracking-tight">ReliefGrid</div>
            {subtitle ? <div className="mt-1 hidden truncate text-xs text-soft sm:block">{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {children}
          {email ? <span className="hidden max-w-[180px] truncate text-xs text-soft lg:inline">{email}</span> : null}
          {onSignOut ? (
            <button onClick={onSignOut} className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper">
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
