import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { IncidentBoard } from "./components/IncidentBoard";
import { OfferMatrix } from "./components/OfferMatrix";
import { AllocationInspector } from "./components/AllocationInspector";
import { AuditReceipt } from "./components/AuditReceipt";
import { CounterfactualLab } from "./components/CounterfactualLab";
import { DecisionReplay, ReplayBoundary } from "./components/DecisionReplay";
import { NewIncidentForm } from "./components/NewIncidentForm";
import { SupplierOutreach } from "./components/SupplierOutreach";
import { WelcomeHero } from "./components/WelcomeHero";
import { PublicRecallCheck } from "./components/PublicRecallCheck";
import { BasketSummary } from "./components/BasketSummary";
import { DecisionReport } from "./pages/DecisionReport";
import { formatDate, formatDeadline } from "./lib/format";
import { nextStepForWorkspace } from "./lib/outreach";
export default function App() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !authError) {
      void signIn("anonymous").catch((cause) => setAuthError(cause instanceof Error ? cause.message : "Could not start a secure workspace"));
    }
  }, [authError, authLoading, isAuthenticated, signIn]);
  const incidentQuery = useQuery(api.incidents.listIncidents, isAuthenticated ? {} : "skip");
  const allIncidents = incidentQuery ?? [];
  const [incidentSearch, setIncidentSearch] = useState("");
  const searchedIncidents: any = useQuery(
    api.search.searchIncidents,
    incidentSearch.trim() ? { query: incidentSearch } : "skip",
  ) ?? [];
  const incidents: any[] = incidentSearch.trim() ? searchedIncidents : allIncidents;
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Auto-select first incident when loaded
  const activeIncidentId = selectedIncidentId ?? (incidents[0]?._id as string | undefined);
  const activeIncident = incidents.find((i) => i._id === activeIncidentId) ?? incidents[0] ?? null;

  const needs = useQuery(
    api.needs.listNeedsByIncident,
    activeIncident ? { incidentId: activeIncident._id } : "skip",
  ) ?? [];

  const [selectedNeedId, setSelectedNeedId] = useState<string | null>(null);
  const activeNeed = (needs.find((n: any) => n._id === selectedNeedId) ?? needs[0] ?? null) as any;

  const suppliers = useQuery(api.suppliers.listSuppliers, isAuthenticated ? {} : "skip") ?? [];

  // One joined backend read per active need replaces the fan-out of
  // offers/plans/threads/checks/coverage subscriptions.
  const workspace: any = useQuery(
    api.workspace.getNeedWorkspace,
    activeNeed ? { needId: activeNeed._id } : "skip",
  );
  const offers = workspace?.offers ?? [];
  const threads = workspace?.threads ?? [];
  const latestPlan = workspace?.latestPlan ?? null;
  const verifiedOfferCount = workspace?.verifiedOfferCount ?? 0;

  // The coordinator's only question is "what do I do now?" — answered from
  // live state by the outreach coordinator module.
  const nextStep: string = nextStepForWorkspace({
    hasNeed: Boolean(activeNeed),
    threadCount: threads.length,
    offerCount: offers.length,
    verifiedCount: verifiedOfferCount,
    requiresEvidence: Boolean(activeNeed?.certRequired),
    hasPlan: Boolean(latestPlan),
    planApproved: latestPlan?.status === "approved",
  });

  const createIncident = useMutation(api.incidents.createIncident);
  const createNeed = useMutation(api.needs.createNeed);
  const computeAllocation = useMutation(api.allocations.computeAllocation);
  const approvePlan = useMutation(api.allocations.approvePlan);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showNewIncident, setShowNewIncident] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreateRequirement = async (values: any) => {
    const deadlineAt = new Date(values.deadlineLocal).getTime();
    const incidentId: any = await createIncident({ title: values.title, description: values.description || undefined, deadlineAt });
    let firstNeedId: any = null;
    for (const line of values.items) {
      const needId: any = await createNeed({
        incidentId,
        item: line.item,
        qty: line.qty,
        deadlineAt,
        budgetCents: Math.round(line.budgetDollars * 100),
        certRequired: values.certification || undefined,
        evidenceKey: values.evidenceKey || undefined,
        partialAllowed: true,
        unit: "units",
        deliveryLocation: values.deliveryLocation,
        timezone: values.timezone,
        currency: "USD",
      });
      firstNeedId ??= needId;
    }
    setSelectedIncidentId(incidentId);
    setSelectedNeedId(firstNeedId);
    setShowNewIncident(false);
    showToast(values.items.length > 1
      ? `${values.items.length} requests created — add suppliers and approve outreach`
      : "Requirement created — add suppliers and approve outreach");
  };

  const handleRecompute = async () => {
    if (!activeNeed) return;
    setBusy(true);
    try {
      await computeAllocation({ needId: activeNeed._id });
      showToast("Allocation recomputed");
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!latestPlan) return;
    setBusy(true);
    try {
      await approvePlan({ planId: latestPlan._id });
      showToast("Allocation approved — supplier notices queued");
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (window.location.pathname === "/report") return <DecisionReport />;

  if (authError && !isAuthenticated) {
    return (
      <div className="grid h-dvh place-items-center overflow-hidden bg-paper p-6 text-center">
        <div className="card max-w-md p-8">
          <div className="font-semibold text-seal">Secure workspace unavailable</div>
          <div className="mt-2 max-w-md text-sm text-soft">{authError}</div>
          <button onClick={() => setAuthError(null)} className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90">Retry</button>
        </div>
      </div>
    );
  }
  if (authLoading || !isAuthenticated) {
    return <div className="grid h-dvh place-items-center bg-paper text-soft">Starting a secure workspace…</div>;
  }

  if (incidentQuery === undefined) {
    return <div className="grid h-dvh place-items-center bg-paper text-soft">Loading workspace…</div>;
  }

  if (allIncidents.length === 0) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
        <header className="shrink-0 border-b border-hairline bg-sheet">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center px-4 lg:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ledger font-serif text-[18px] font-bold text-white">R</div>
              <div>
                <div className="font-serif text-[19px] font-bold leading-none tracking-tight">ReliefGrid</div>
                <div className="mt-1 hidden text-xs text-soft sm:block">Evidence-backed supplier coordination</div>
              </div>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 p-4 sm:p-6">
          <WelcomeHero onCreate={() => setShowNewIncident(true)} />
        </main>
        {showNewIncident && <NewIncidentForm onCancel={() => setShowNewIncident(false)} onCreate={handleCreateRequirement} />}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      {/* Header */}
      <header className="z-40 shrink-0 border-b border-hairline bg-sheet">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ledger font-serif text-[18px] font-bold text-white">R</div>
            <div>
              <div className="font-serif text-[19px] font-bold leading-none tracking-tight">ReliefGrid</div>
              <div className="mt-1 hidden text-xs text-soft sm:block">Turn supplier quote emails into a decision you can defend</div>
            </div>
            <span className="ml-3 hidden items-center gap-1.5 rounded-[4px] border border-hairline bg-sheet px-2 py-0.5 text-[11px] font-semibold text-ledger md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full border border-ledger" /> Live
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs tabular-nums text-soft lg:inline">
              {activeIncident ? `${needs.length} needs, ${offers.length} offers` : "No incident"}
            </span>
            <input
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              placeholder="Search incidents…"
              className="hidden w-44 rounded-lg border border-hairline bg-paper px-3 py-1.5 text-xs placeholder:text-soft/70 focus:border-ledger focus:outline-none md:inline-block"
            />
            <button
              onClick={() => setShowNewIncident(true)}
              className="inline-flex rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep md:px-4 md:text-sm"
            >
              New Incident
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Stats bar */}
      <div className="mx-auto w-full max-w-[1400px] shrink-0 px-4 pt-3 lg:px-6">
        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-hairline md:grid-cols-4">
          <div className="bg-sheet p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-soft">Secured</div>
            <div className="mt-1 text-base font-semibold tabular-nums leading-none">
              {activeNeed ? `${latestPlan ? latestPlan.totalQty : 0} / ${activeNeed.qty}` : "—"}
              <span className="ml-1 text-xs font-normal text-soft">units</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#e7e2d3]">
              <div
                className="h-full bg-ledger"
                style={{ width: activeNeed && latestPlan ? `${Math.min(100, (latestPlan.totalQty / activeNeed.qty) * 100)}%` : "0%" }}
              />
            </div>
          </div>
          <div className="bg-sheet p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-soft">Deadline</div>
            <div className="mt-1 text-base font-semibold tabular-nums" title={activeNeed ? new Date(activeNeed.deadlineAt).toString() : undefined}>{activeNeed ? (activeNeed.deadlineAt - Date.now() < 48 * 3600000 ? formatDeadline(activeNeed.deadlineAt) : formatDate(activeNeed.deadlineAt)) : "—"}</div>
          </div>
          <div className="bg-sheet p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-soft">Budget</div>
            <div className="mt-1 text-base font-semibold tabular-nums">
              {latestPlan ? `$${(latestPlan.totalCostCents / 100).toFixed(0)}` : "$0"} <span className="text-sm font-normal text-soft">/ {activeNeed ? `$${(activeNeed.budgetCents / 100).toFixed(0)}` : "—"}</span>
            </div>
          </div>
          <div className="bg-sheet p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-soft">Suppliers</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{threads.length} <span className="text-xs font-normal text-soft">contacted, {offers.length} offers, {verifiedOfferCount} verified</span></div>
          </div>
        </div>
      </div>

      {/* Current action */}
      {activeIncident && (
        <div className="mx-auto w-full max-w-[1400px] shrink-0 px-4 pt-3 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-ledger/30 bg-[#eaf2ed] px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ledger-deep">Next</span>
            <span className="text-sm text-ink">{nextStep}</span>
          </div>
        </div>
      )}
      {activeIncident && <div className="shrink-0 [&>div]:pt-3"><BasketSummary incidentId={activeIncident._id} /></div>}
      <div className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-1 gap-3 overflow-y-auto px-4 py-3 lg:grid-cols-12 lg:overflow-hidden lg:px-6">
        {/* Left: Incident Board */}
        <div className="space-y-3 lg:col-span-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <IncidentBoard
            incidents={incidents}
            needs={needs}
            activeIncident={activeIncident}
            activeNeed={activeNeed}
            onSelectIncident={(id: string) => setSelectedIncidentId(id)}
            onSelectNeed={(id: string) => setSelectedNeedId(id)}
          />
          <SupplierOutreach needId={activeNeed?._id} needs={needs} suppliers={suppliers} threads={threads} />
          <PublicRecallCheck
            needId={activeNeed?._id}
            coverage={latestPlan?.totalQty ?? 0}
            target={activeNeed?.qty ?? 0}
          />
          <div className="card p-4">
            <div className="eyebrow">Decision controls</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={handleRecompute} disabled={!activeNeed || offers.length === 0 || busy} className="rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50">
                Compute allocation
              </button>
              <button onClick={handleApprove} disabled={!latestPlan || latestPlan.status === "approved" || busy} className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50">
                Approve plan
              </button>
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-soft">Allocation uses only eligible offers. Review the recommendation before approving supplier notices.</div>
          </div>
        </div>

        {/* Center: Offer Matrix */}
        <div className="lg:col-span-5 lg:min-h-0 lg:overflow-y-auto lg:px-0.5">
          {activeNeed ? (
            <OfferMatrix offers={offers} coverage={workspace?.coverage ?? null} />
          ) : (
            <div className="card p-6">
              <div className="text-sm font-semibold">No request selected</div>
              <div className="mt-1 text-sm text-soft">Create a requirement to start collecting comparable supplier quotes.</div>
            </div>
          )}
        </div>

        {/* Right: Allocation Inspector */}
        <div className="space-y-3 lg:col-span-4 lg:min-h-0 lg:overflow-y-auto lg:pl-1">
          {activeNeed && <AllocationInspector plan={latestPlan} need={activeNeed} offers={offers} />}
          {latestPlan && <AuditReceipt need={activeNeed} plan={latestPlan} />}
          {activeNeed && (
            <details className="card overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-ink">How was this decision made?</summary>
              <div className="border-t border-hairline p-3"><CounterfactualLab needId={activeNeed?._id} /></div>
            </details>
          )}
          {activeIncident && (
            <ReplayBoundary key={activeIncident._id}>
              <DecisionReplay incidentId={activeIncident._id} />
            </ReplayBoundary>
          )}
        </div>
      </div>

      </main>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper">
          {toast}
        </div>
      )}
      {showNewIncident && <NewIncidentForm onCancel={() => setShowNewIncident(false)} onCreate={handleCreateRequirement} />}
    </div>
  );
}
