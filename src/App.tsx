import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { IncidentBoard } from "./components/IncidentBoard";
import { OfferMatrix } from "./components/OfferMatrix";
import { AllocationInspector } from "./components/AllocationInspector";
import { AuditReceipt } from "./components/AuditReceipt";
import { ProviderProof } from "./components/ProviderProof";
import { DemoRail } from "./components/DemoRail";
import { EvidenceDrift } from "./components/EvidenceDrift";
import { DemoBulletin } from "./pages/DemoBulletin";
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
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !authError) {
      void signIn("anonymous").catch((cause) => setAuthError(cause instanceof Error ? cause.message : "Could not start a secure workspace"));
    }
  }, [authError, authLoading, isAuthenticated, signIn]);
  const allIncidents = useQuery(api.incidents.listIncidents, isAuthenticated ? {} : "skip") ?? [];
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
    hasPlan: Boolean(latestPlan),
    planApproved: latestPlan?.status === "approved",
  });

  const resetDemo = useMutation(api.demo.resetDemo);
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

  const handleSeed = async () => {
    setBusy(true);
    try {
      const res = await resetDemo({});
      if (res?.incidentId) setSelectedIncidentId(res.incidentId);
      if (res?.needId) setSelectedNeedId(res.needId);
      showToast("Sample scenario reloaded");
    } catch (e: any) {
      showToast(e.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
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

  if (window.location.pathname === "/demo-bulletin") return <DemoBulletin />;
  if (window.location.pathname === "/report") return <DecisionReport />;

  if (authError && !isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper p-6 text-center">
        <div className="card max-w-md p-8">
          <div className="font-semibold text-seal">Secure workspace unavailable</div>
          <div className="mt-2 max-w-md text-sm text-soft">{authError}</div>
          <button onClick={() => setAuthError(null)} className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90">Retry</button>
        </div>
      </div>
    );
  }
  if (authLoading || !isAuthenticated) {
    return <div className="grid min-h-screen place-items-center bg-paper text-soft">Starting a secure workspace…</div>;
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-sheet">
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
            {demoMode && <button
              onClick={handleSeed}
              disabled={busy}
              className="rounded-lg border border-hairline bg-sheet px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
            >
              {busy ? "..." : "Reload sample"}
            </button>}
            <button
              onClick={() => setShowNewIncident(true)}
              className="inline-flex rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep md:px-4 md:text-sm"
            >
              New Incident
            </button>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="mx-auto max-w-[1400px] px-4 pt-4 lg:px-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card p-4">
            <div className="eyebrow">Secured</div>
            <div className="mt-1 font-serif text-[28px] font-bold tabular-nums leading-none">
              {activeNeed ? `${latestPlan ? latestPlan.totalQty : 0} / ${activeNeed.qty}` : "—"}
              <span className="ml-1 align-middle font-sans text-sm font-normal text-soft">units</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e7e2d3]">
              <div
                className="h-full bg-ledger"
                style={{ width: activeNeed && latestPlan ? `${Math.min(100, (latestPlan.totalQty / activeNeed.qty) * 100)}%` : "0%" }}
              />
            </div>
          </div>
          <div className="card p-4">
            <div className="eyebrow">Deadline</div>
            <div className="mt-1 text-lg font-semibold tabular-nums" title={activeNeed ? new Date(activeNeed.deadlineAt).toString() : undefined}>{activeNeed ? (activeNeed.deadlineAt - Date.now() < 48 * 3600000 ? formatDeadline(activeNeed.deadlineAt) : formatDate(activeNeed.deadlineAt)) : "—"}</div>
            <div className={`mt-1 text-xs ${activeNeed && activeNeed.deadlineAt - Date.now() < 2 * 3600000 ? "font-medium text-seal" : "text-soft"}`}>{activeNeed ? (activeNeed.deadlineAt - Date.now() < 2 * 3600000 ? "Critical window" : "On track") : "No need"}</div>
          </div>
          <div className="card p-4">
            <div className="eyebrow">Budget</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {latestPlan ? `$${(latestPlan.totalCostCents / 100).toFixed(0)}` : "$0"} <span className="text-sm font-normal text-soft">/ {activeNeed ? `$${(activeNeed.budgetCents / 100).toFixed(0)}` : "—"}</span>
            </div>
            <div className="mt-1 text-xs text-soft">{latestPlan ? `${((latestPlan.totalCostCents / (activeNeed?.budgetCents ?? 1)) * 100).toFixed(0)}% utilized` : "No plan"}</div>
          </div>
          <div className="card p-4">
            <div className="eyebrow">Suppliers</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{threads.length} <span className="text-sm font-normal text-soft">contacted</span></div>
            <div className="mt-1 text-xs text-soft">{offers.length} offers, {offers.filter((o: any) => o.certStatus === "verified").length} verified</div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      {incidents.length === 0 && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4 lg:px-6">
          <WelcomeHero busy={busy} onLoadSample={() => void handleSeed()} onCreate={() => setShowNewIncident(true)} />
        </div>
      )}
      {!demoMode && activeIncident && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-ledger/30 bg-[#eaf2ed] px-4 py-3">
            <span className="text-sm font-semibold text-ledger-deep">Next:</span>
            <span className="text-sm text-ink">{nextStep}</span>
            {!activeNeed && (
              <button onClick={() => setShowNewIncident(true)} className="rounded-lg bg-ledger px-3 py-1.5 text-xs font-medium text-white hover:bg-ledger-deep">
                New requirement
              </button>
            )}
          </div>
        </div>
      )}
      {activeIncident && <BasketSummary incidentId={activeIncident._id} />}
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-12 lg:px-6">
        {/* Left: Incident Board */}
        <div className="space-y-4 lg:col-span-3">
          {demoMode && <DemoRail
            hasNeed={Boolean(activeNeed)}
            threadCount={threads.length}
            offerCount={offers.length}
            verifiedOfferCount={verifiedOfferCount}
            planStatus={latestPlan?.status}
            busy={busy}
            onReset={handleSeed}
          />}
          <IncidentBoard
            incidents={incidents}
            needs={needs}
            activeIncident={activeIncident}
            activeNeed={activeNeed}
            onSelectIncident={(id: string) => setSelectedIncidentId(id)}
            onSelectNeed={(id: string) => setSelectedNeedId(id)}
          />
          {!demoMode && <SupplierOutreach needId={activeNeed?._id} needs={needs} suppliers={suppliers} threads={threads} />}
          {!demoMode && <PublicRecallCheck
            needId={activeNeed?._id}
            coverage={latestPlan?.totalQty ?? 0}
            target={activeNeed?.qty ?? 0}
          />}
          {demoMode && <EvidenceDrift
            needId={activeNeed?._id}
            coverage={latestPlan?.totalQty ?? 0}
            target={activeNeed?.qty ?? 0}
          />}
          {demoMode && <div className="card p-4">
            <div className="eyebrow">Demo controls</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={handleRecompute} disabled={!activeNeed || busy} className="rounded-lg border border-hairline bg-sheet px-3 py-2 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50">
                Recompute
              </button>
              <button onClick={handleApprove} disabled={!latestPlan || latestPlan.status === "approved" || busy} className="rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep disabled:opacity-50">
                Approve Plan
              </button>
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-soft">Reset creates 3 synthetic offers: Apex 70 (EN), BlueRiver 100 late, Casa 30 (ES). Allocation picks 70+30. Extraction runs live via Groq, verification via Firecrawl, RFQ sends via AgentMail — ledger below proves each run.</div>
          </div>}
        </div>

        {/* Center: Offer Matrix */}
        <div className="lg:col-span-5">
          {activeNeed ? (
            <OfferMatrix offers={offers} coverage={workspace?.coverage ?? null} />
          ) : (
            <div className="card p-6">
              <div className="text-sm font-semibold">No request selected</div>
              <div className="mt-1 text-sm text-soft">Create a requirement to start collecting comparable supplier quotes.</div>
              <button onClick={() => setShowNewIncident(true)} className="mt-3 rounded-lg bg-ledger px-3 py-2 text-xs font-medium text-white hover:bg-ledger-deep">
                Create requirement
              </button>
            </div>
          )}
        </div>

        {/* Right: Allocation Inspector */}
        <div className="space-y-4 lg:col-span-4">
          {activeNeed && <AllocationInspector plan={latestPlan} need={activeNeed} offers={offers} />}
          {latestPlan && <AuditReceipt need={activeNeed} plan={latestPlan} />}
          {activeNeed && (demoMode ? <CounterfactualLab needId={activeNeed?._id} /> : (
            <details className="card overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-ink">How was this decision made?</summary>
              <div className="border-t border-hairline p-3"><CounterfactualLab needId={activeNeed?._id} /></div>
            </details>
          ))}
          {demoMode && <details className="card overflow-hidden">
            <summary className="eyebrow cursor-pointer px-4 py-3">How this was decided</summary>
            <div className="border-t border-hairline p-3"><ProviderProof /></div>
          </details>}
        </div>
      </div>

      {demoMode && <div className="mx-auto max-w-[1400px] px-4 pb-6 lg:px-6">
        <ReplayBoundary key={activeIncident?._id ?? "none"}>
          <DecisionReplay incidentId={activeIncident?._id} />
        </ReplayBoundary>
      </div>}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper">
          {toast}
        </div>
      )}
      {showNewIncident && <NewIncidentForm onCancel={() => setShowNewIncident(false)} onCreate={handleCreateRequirement} />}
    </div>
  );
}
