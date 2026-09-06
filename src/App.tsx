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

  const offers = useQuery(
    api.offers.listOffersByNeed,
    activeNeed ? { needId: activeNeed._id } : "skip",
  ) ?? [];

  const suppliers = useQuery(api.suppliers.listSuppliers, isAuthenticated ? {} : "skip") ?? [];

  const plans = useQuery(
    api.allocations.listAllocationPlans,
    activeNeed ? { needId: activeNeed._id } : "skip",
  ) ?? [];

  const latestPlan = plans[0] ?? null;

  const threads = useQuery(
    api.rfq.listThreadsByNeed,
    activeNeed ? { needId: activeNeed._id } : "skip",
  ) ?? [];
  const sourceChecks = useQuery(
    api.sourceChecks.listSourceChecksByNeed,
    activeNeed ? { needId: activeNeed._id } : "skip",
  ) ?? [];

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
      showToast("Demo reset — canonical scenario restored");
    } catch (e: any) {
      showToast(e.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRequirement = async (values: any) => {
    const deadlineAt = new Date(values.deadlineLocal).getTime();
    const incidentId: any = await createIncident({ title: values.title, description: values.description || undefined, deadlineAt });
    const needId: any = await createNeed({
      incidentId,
      item: values.item,
      qty: values.qty,
      deadlineAt,
      budgetCents: Math.round(values.budgetDollars * 100),
      certRequired: values.certification || undefined,
      evidenceKey: values.evidenceKey || undefined,
      partialAllowed: true,
      unit: "units",
      deliveryLocation: values.deliveryLocation,
      timezone: values.timezone,
      currency: "USD",
    });
    setSelectedIncidentId(incidentId);
    setSelectedNeedId(needId);
    setShowNewIncident(false);
    showToast("Requirement created — add suppliers and approve outreach");
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

  const handleSimulateShortfall = async () => {
    showToast("Shortfall simulation: edit offer via Convex dashboard or re-seed with varied qty");
  };

  if (window.location.pathname === "/demo-bulletin") return <DemoBulletin />;

  if (authError && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] text-slate-300 grid place-items-center p-6 text-center">
        <div>
          <div className="font-semibold text-red-200">Secure workspace unavailable</div>
          <div className="mt-2 max-w-md text-sm text-slate-400">{authError}</div>
          <button onClick={() => setAuthError(null)} className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0a0e1a]">Retry</button>
        </div>
      </div>
    );
  }
  if (authLoading || !isAuthenticated) {
    return <div className="min-h-screen bg-[#0a0e1a] text-slate-300 grid place-items-center">Starting a secure workspace…</div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0a0e1a]/80 border-b border-[#1e2d4a]">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center font-bold text-white text-[16px]">◈</div>
            <div>
              <div className="font-bold tracking-tight leading-none">ReliefGrid</div>
              <div className="text-[11px] tracking-[0.14em] uppercase text-slate-400 -mt-0.5">Emergency Supply Coordinator</div>
            </div>
            <span className="hidden md:inline-flex ml-3 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> LIVE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden lg:inline text-xs text-slate-400 mono">
              {activeIncident ? `${needs.length} needs · ${offers.length} offers` : "No incident"}
            </span>
            <input
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              placeholder="Search incidents…"
              className="hidden md:inline-block w-40 px-3 py-2 rounded-full bg-[#1a2332] border border-[#1e2d4a] text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/40"
            />
            {demoMode && <button
              onClick={handleSeed}
              disabled={busy}
              className="px-4 py-2 rounded-full bg-white text-[#0a0e1a] text-sm font-semibold hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "..." : "Reset Demo"}
            </button>}
            <button
              onClick={() => setShowNewIncident(true)}
              className="inline-flex px-3 md:px-4 py-2 rounded-full bg-[#1a2332] border border-[#1e2d4a] text-xs md:text-sm font-medium hover:bg-[#1e2d4a]"
            >
              New Incident
            </button>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 pt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
            <div className="text-[11px] tracking-[0.14em] uppercase text-slate-400">Secured</div>
            <div className="text-2xl font-bold mt-1">
              {activeNeed ? `${latestPlan ? latestPlan.totalQty : 0} / ${activeNeed.qty}` : "—"}
              <span className="text-sm font-normal text-slate-400"> units</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#1e2d4a] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                style={{ width: activeNeed && latestPlan ? `${Math.min(100, (latestPlan.totalQty / activeNeed.qty) * 100)}%` : "0%" }}
              />
            </div>
          </div>
          <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
            <div className="text-[11px] tracking-[0.14em] uppercase text-slate-400">Deadline</div>
            <div className="text-lg font-semibold mt-1 mono">{activeNeed ? new Date(activeNeed.deadlineAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</div>
            <div className="text-xs text-amber-400 mt-1">{activeNeed ? (activeNeed.deadlineAt - Date.now() < 2 * 3600000 ? "Critical window" : "On track") : "No need"}</div>
          </div>
          <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
            <div className="text-[11px] tracking-[0.14em] uppercase text-slate-400">Budget</div>
            <div className="text-lg font-semibold mt-1">
              {latestPlan ? `$${(latestPlan.totalCostCents / 100).toFixed(0)}` : "$0"} <span className="text-sm font-normal text-slate-400">/ ${activeNeed ? `$${(activeNeed.budgetCents / 100).toFixed(0)}` : "—"}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">{latestPlan ? `${((latestPlan.totalCostCents / (activeNeed?.budgetCents ?? 1)) * 100).toFixed(0)}% utilized` : "No plan"}</div>
          </div>
          <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
            <div className="text-[11px] tracking-[0.14em] uppercase text-slate-400">Suppliers</div>
            <div className="text-lg font-semibold mt-1">{threads.length} <span className="text-sm font-normal text-slate-400">contacted</span></div>
            <div className="text-xs text-slate-400 mt-1">{offers.length} offers · {offers.filter((o: any) => o.certStatus === "verified").length} verified</div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Incident Board */}
        <div className="lg:col-span-3 space-y-4">
          {demoMode && <DemoRail
            hasNeed={Boolean(activeNeed)}
            threadCount={threads.length}
            offerCount={offers.length}
            verifiedOfferCount={offers.filter((offer: any) =>
              sourceChecks.some((check: any) => check.offerId === offer._id && check.status === "verified"),
            ).length}
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
          {!demoMode && <SupplierOutreach needId={activeNeed?._id} suppliers={suppliers} threads={threads} />}
          {demoMode && <EvidenceDrift
            needId={activeNeed?._id}
            coverage={latestPlan?.totalQty ?? 0}
            target={activeNeed?.qty ?? 0}
          />}
          {demoMode && <div className="rounded-2xl bg-[#111827] border border-[#1e2d4a] p-4">
            <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Demo controls</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={handleRecompute} disabled={!activeNeed || busy} className="px-3 py-2 rounded-xl bg-[#1a2332] border border-[#1e2d4a] text-xs font-medium disabled:opacity-50">
                Recompute
              </button>
              <button onClick={handleApprove} disabled={!latestPlan || latestPlan.status === "approved" || busy} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">
                Approve Plan
              </button>
              <button onClick={handleSimulateShortfall} className="col-span-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                Simulate shortfall → new plan
              </button>
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-slate-500">Reset creates 3 synthetic offers: Apex 70 (EN), BlueRiver 100 late, Casa 30 (ES). Allocation picks 70+30. Extraction runs live via Groq, verification via Firecrawl, RFQ sends via AgentMail — ledger below proves each run.</div>
          </div>}
        </div>

        {/* Center: Offer Matrix */}
        <div className="lg:col-span-5">
          <OfferMatrix offers={offers} activeNeed={activeNeed} />
        </div>

        {/* Right: Allocation Inspector */}
        <div className="lg:col-span-4 space-y-4">
          <AllocationInspector plan={latestPlan} need={activeNeed} offers={offers} />
          <AuditReceipt need={activeNeed} plan={latestPlan} />
          <CounterfactualLab needId={activeNeed?._id} />
          {demoMode && <details className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-xs tracking-[0.14em] uppercase text-slate-400">Judge proof and assistant</summary>
            <div className="p-3"><ProviderProof /></div>
          </details>}
        </div>
      </div>

      {demoMode && <div className="max-w-[1600px] mx-auto px-4 lg:px-6 pb-4">
        <ReplayBoundary key={activeIncident?._id ?? "none"}>
          <DecisionReplay incidentId={activeIncident?._id} />
        </ReplayBoundary>
      </div>}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white text-[#0a0e1a] px-4 py-2 rounded-full text-sm font-medium shadow-xl">
          {toast}
        </div>
      )}
      {showNewIncident && <NewIncidentForm onCancel={() => setShowNewIncident(false)} onCreate={handleCreateRequirement} />}
    </div>
  );
}
