import { useState } from "react";
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
import { AuthScreen } from "./components/AuthScreen";
import { AppHeader } from "./components/AppHeader";
import { WorkspaceFlow } from "./components/WorkspaceFlow";
import { formatDeadline } from "./lib/format";
import {
  flowStepAvailable,
  flowStepForWorkspace,
  nextStepForWorkspace,
  type WorkspaceFlowStep,
} from "./lib/outreach";

export default function App() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const currentUser = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const incidentQuery = useQuery(api.incidents.listIncidents, isAuthenticated ? {} : "skip");
  const allIncidents = incidentQuery ?? [];
  const [incidentSearch, setIncidentSearch] = useState("");
  const searchedIncidents: any = useQuery(
    api.search.searchIncidents,
    incidentSearch.trim() ? { query: incidentSearch } : "skip",
  ) ?? [];
  const incidents: any[] = incidentSearch.trim() ? searchedIncidents : allIncidents;
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const activeIncidentId = selectedIncidentId ?? (incidents[0]?._id as string | undefined);
  const activeIncident = incidents.find((i) => i._id === activeIncidentId) ?? incidents[0] ?? null;

  const needs = useQuery(
    api.needs.listNeedsByIncident,
    activeIncident ? { incidentId: activeIncident._id } : "skip",
  ) ?? [];

  const [selectedNeedId, setSelectedNeedId] = useState<string | null>(null);
  const activeNeed = (needs.find((n: any) => n._id === selectedNeedId) ?? needs[0] ?? null) as any;

  const suppliers = useQuery(api.suppliers.listSuppliers, isAuthenticated ? {} : "skip") ?? [];

  const workspace: any = useQuery(
    api.workspace.getNeedWorkspace,
    activeNeed ? { needId: activeNeed._id } : "skip",
  );
  const offers = workspace?.offers ?? [];
  const threads = workspace?.threads ?? [];
  const latestPlan = workspace?.latestPlan ?? null;
  const verifiedOfferCount = workspace?.verifiedOfferCount ?? 0;
  const inboxEmail: string | undefined = workspace?.inbox?.email;

  const flowArgs = {
    hasNeed: Boolean(activeNeed),
    supplierCount: suppliers.length,
    threadCount: threads.length,
    offerCount: offers.length,
    verifiedCount: verifiedOfferCount,
    requiresEvidence: Boolean(activeNeed?.certRequired),
    hasPlan: Boolean(latestPlan),
    planApproved: latestPlan?.status === "approved",
  };
  const nextStep = nextStepForWorkspace(flowArgs);
  const derivedStep = flowStepForWorkspace(flowArgs);

  const [stepOverride, setStepOverride] = useState<WorkspaceFlowStep | null>(null);
  const override = stepOverride && flowStepAvailable(stepOverride, flowArgs) ? stepOverride : null;
  const activeStep = override ?? derivedStep;

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

  const openStep = (step: WorkspaceFlowStep) => {
    if (!flowStepAvailable(step, flowArgs)) return;
    setStepOverride(step);
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
    setStepOverride("suppliers");
    setShowNewIncident(false);
    showToast(values.items.length > 1
      ? `${values.items.length} requests created — add suppliers`
      : "Requirement created — add suppliers");
  };

  const handleRecompute = async () => {
    if (!activeNeed) return;
    setBusy(true);
    try {
      await computeAllocation({ needId: activeNeed._id });
      showToast("Recommendation recomputed");
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

  const newRequirementButton = (
    <button
      onClick={() => setShowNewIncident(true)}
      className="inline-flex rounded-lg border border-hairline px-3 py-2 text-xs font-medium text-ink hover:bg-paper md:px-4 md:text-sm"
    >
      New requirement
    </button>
  );

  if (window.location.pathname === "/report") return <DecisionReport />;

  if (authLoading) {
    return <div className="grid h-dvh place-items-center bg-paper text-soft">Loading…</div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
        <AppHeader subtitle="Supplier quote emails, compared and approved" />
        <main className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,24rem)] lg:items-center lg:px-8">
          <WelcomeHero />
          <div className="flex justify-center lg:justify-end"><AuthScreen /></div>
        </main>
      </div>
    );
  }

  if (incidentQuery === undefined) {
    return <div className="grid h-dvh place-items-center bg-paper text-soft">Loading workspace…</div>;
  }

  if (allIncidents.length === 0) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
        <AppHeader
          subtitle="Evidence-backed supplier coordination"
          email={currentUser?.email}
          onSignOut={() => void signOut()}
        >
          {newRequirementButton}
        </AppHeader>
        <main className="min-h-0 flex-1 p-4 sm:p-6">
          <WelcomeHero signedIn onCreate={() => setShowNewIncident(true)} />
        </main>
        {showNewIncident && <NewIncidentForm onCancel={() => setShowNewIncident(false)} onCreate={handleCreateRequirement} />}
      </div>
    );
  }

  const available: Record<WorkspaceFlowStep, boolean> = {
    requirement: flowStepAvailable("requirement", flowArgs),
    suppliers: flowStepAvailable("suppliers", flowArgs),
    quotes: flowStepAvailable("quotes", flowArgs),
    decide: flowStepAvailable("decide", flowArgs),
  };

  const summaries: Record<WorkspaceFlowStep, { title: string; detail: string }> = {
    requirement: {
      title: activeIncident?.title ?? "Requirement",
      detail: activeNeed
        ? `${activeNeed.item} · ${activeNeed.qty} units`
        : "Create what to buy",
    },
    suppliers: {
      title: "Suppliers",
      detail: suppliers.length
        ? `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}${threads.length ? ` · ${threads.length} requested` : ""}`
        : "Add contacts, optionally send a request",
    },
    quotes: {
      title: "Quotes",
      detail: offers.length
        ? `${offers.length} quote${offers.length === 1 ? "" : "s"}${activeNeed?.certRequired ? ` · ${verifiedOfferCount} verified` : ""}`
        : "Paste a quote or wait for replies",
    },
    decide: {
      title: "Decide",
      detail: !latestPlan
        ? "Compute a recommendation from the quotes on hand"
        : latestPlan.status === "approved"
          ? "Plan approved"
          : "Review the recommendation and approve",
    },
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <AppHeader
        narrow
        subtitle="Supplier quote emails, compared and approved"
        email={currentUser?.email}
        onSignOut={() => void signOut()}
      >
        {newRequirementButton}
      </AppHeader>

      <main className="min-h-0 flex-1">
        <WorkspaceFlow
          derivedStep={derivedStep}
          activeStep={activeStep}
          available={available}
          summaries={summaries}
          onSelectStep={openStep}
          hint={nextStep}
        >
          {{
            requirement: (
              <>
                {activeNeed ? (
                  <p className="text-xs tabular-nums text-soft">
                    Needed by {formatDeadline(activeNeed.deadlineAt)}
                    {activeNeed.deliveryLocation ? ` · ${activeNeed.deliveryLocation}` : ""}
                  </p>
                ) : null}
                <IncidentBoard
                  incidents={incidents}
                  needs={needs}
                  activeIncident={activeIncident}
                  activeNeed={activeNeed}
                  onSelectIncident={(id: string) => {
                    setSelectedIncidentId(id);
                    setSelectedNeedId(null);
                    setStepOverride("requirement");
                  }}
                  onSelectNeed={(id: string) => {
                    setSelectedNeedId(id);
                    setStepOverride("requirement");
                  }}
                  search={incidentSearch}
                  onSearch={setIncidentSearch}
                />
                {activeIncident ? <BasketSummary incidentId={activeIncident._id} /> : null}
                {activeNeed ? (
                  <button
                    type="button"
                    onClick={() => openStep("suppliers")}
                    className="w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white hover:bg-ledger-deep"
                  >
                    Continue to suppliers
                  </button>
                ) : null}
              </>
            ),
            suppliers: (
              <>
                <SupplierOutreach needId={activeNeed?._id} needs={needs} suppliers={suppliers} threads={threads} />
                {available.quotes ? (
                  <button
                    type="button"
                    onClick={() => openStep("quotes")}
                    className="w-full rounded-lg border border-hairline bg-sheet px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
                  >
                    Continue to quotes
                  </button>
                ) : (
                  <p className="text-sm text-soft">Add a supplier to paste a quote without sending a request.</p>
                )}
              </>
            ),
            quotes: (
              <>
                {activeNeed ? (
                  <OfferMatrix
                    offers={offers}
                    coverage={workspace?.coverage ?? null}
                    certRequired={activeNeed?.certRequired}
                    inboxEmail={inboxEmail}
                    needId={activeNeed?._id}
                    suppliers={suppliers}
                  />
                ) : (
                  <div className="text-sm text-soft">Create a requirement to collect quotes.</div>
                )}
                {available.decide ? (
                  <button
                    type="button"
                    onClick={() => openStep("decide")}
                    className="w-full rounded-lg border border-hairline bg-sheet px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
                  >
                    Continue to decide
                  </button>
                ) : null}
              </>
            ),
            decide: (
              <>
                {activeIncident ? <BasketSummary incidentId={activeIncident._id} /> : null}
                {activeNeed ? <AllocationInspector plan={latestPlan} need={activeNeed} offers={offers} /> : null}
                <div className="space-y-2">
                  {!latestPlan ? (
                    <button
                      onClick={handleRecompute}
                      disabled={!activeNeed || offers.length === 0 || busy}
                      className="w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
                    >
                      Compute recommendation
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleApprove}
                        disabled={latestPlan.status === "approved" || busy}
                        className="w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white hover:bg-ledger-deep disabled:opacity-50"
                      >
                        {latestPlan.status === "approved" ? "Plan approved" : "Approve plan"}
                      </button>
                      <button
                        onClick={handleRecompute}
                        disabled={!activeNeed || offers.length === 0 || busy}
                        className="w-full rounded-lg border border-hairline bg-sheet px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
                      >
                        Compute recommendation
                      </button>
                    </>
                  )}
                  <p className="text-[11px] leading-relaxed text-soft">
                    Only eligible quotes are used. Review the recommendation before supplier notices go out.
                  </p>
                </div>
                <details className="rounded-[10px] border border-hairline bg-sheet">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-ink">Advanced</summary>
                  <div className="space-y-3 border-t border-hairline p-3">
                    {latestPlan ? <AuditReceipt need={activeNeed} plan={latestPlan} /> : null}
                    {activeNeed ? (
                      <div className="rounded-[10px] border border-hairline">
                        <CounterfactualLab needId={activeNeed._id} />
                      </div>
                    ) : null}
                    {activeNeed ? (
                      <div className="rounded-[10px] border border-hairline p-3">
                        <PublicRecallCheck
                          needId={activeNeed._id}
                          coverage={latestPlan?.totalQty ?? 0}
                          target={activeNeed.qty ?? 0}
                        />
                      </div>
                    ) : null}
                    {activeIncident ? (
                      <div className="rounded-[10px] border border-hairline p-3">
                        <ReplayBoundary key={activeIncident._id}>
                          <DecisionReplay incidentId={activeIncident._id} />
                        </ReplayBoundary>
                      </div>
                    ) : null}
                    {latestPlan?.decisionTrace ? (
                      <details className="rounded-[10px] border border-hairline bg-paper p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-ink">Decision trace</summary>
                        <pre className="mt-2 whitespace-pre-wrap text-[11px] tabular-nums leading-relaxed text-soft">{latestPlan.decisionTrace}</pre>
                      </details>
                    ) : null}
                  </div>
                </details>
              </>
            ),
          }}
        </WorkspaceFlow>
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
