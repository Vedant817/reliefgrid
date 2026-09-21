import { useEffect, useRef, useState } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
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
import { awardDispatchMessage } from "./lib/awards";
import { userFacingError } from "./lib/errors";
import {
  flowStepAvailable,
  flowStepForWorkspace,
  nextStepForWorkspace,
  type WorkspaceFlowStep,
} from "./lib/outreach";

export default function App() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = isAuthenticated && !signingOut;
  const currentUser = useQuery(api.users.me, signedIn ? {} : "skip");
  const incidentQuery = useQuery(api.incidents.listIncidents, signedIn ? {} : "skip");
  const allIncidents = incidentQuery ?? [];
  const [incidentSearch, setIncidentSearch] = useState("");
  const searchedIncidents: any = useQuery(
    api.search.searchIncidents,
    signedIn && incidentSearch.trim() ? { query: incidentSearch } : "skip",
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

  const suppliers = useQuery(api.suppliers.listSuppliers, signedIn ? {} : "skip") ?? [];

  const workspace: any = useQuery(
    api.workspace.getNeedWorkspace,
    activeNeed ? { needId: activeNeed._id } : "skip",
  );
  const offers = workspace?.offers ?? [];
  const threads = workspace?.threads ?? [];
  const latestPlan = workspace?.latestPlan ?? null;
  const verifiedOfferCount = workspace?.verifiedOfferCount ?? 0;
  const recommendationState = workspace?.recommendationState ?? "none";
  const approvalReadiness = workspace?.approvalReadiness ?? { ready: false, reason: "Compute a current recommendation before approval" };
  const inboxEmail: string | undefined = workspace?.inbox?.email;
  const sentThreadCount = threads.filter((thread: any) => Boolean(thread.agentmailMessageId)).length;
  const relevantSupplierIds = new Set([
    ...threads.map((thread: any) => String(thread.supplierId)),
    ...offers.map((offer: any) => String(offer.supplierId)),
  ]);
  const relevantSuppliers = suppliers.filter((supplier: any) => relevantSupplierIds.has(String(supplier._id)));

  const flowArgs = {
    hasNeed: Boolean(activeNeed),
    supplierCount: suppliers.length,
    threadCount: threads.length,
    sentThreadCount,
    offerCount: offers.length,
    verifiedCount: verifiedOfferCount,
    requiresEvidence: Boolean(activeNeed?.certRequired),
    hasPlan: Boolean(latestPlan),
    planApproved: recommendationState === "approved",
    planReady: recommendationState === "ready",
    planInfeasible: recommendationState === "infeasible",
  };
  const nextStep = nextStepForWorkspace(flowArgs);
  const derivedStep = flowStepForWorkspace(flowArgs);

  const [stepOverride, setStepOverride] = useState<WorkspaceFlowStep | null>(null);
  const override = stepOverride && flowStepAvailable(stepOverride, flowArgs) ? stepOverride : null;
  const activeStep = override ?? derivedStep;

  const createRequirement = useMutation(api.incidents.createRequirement);
  const ensureDemoSuppliers = useMutation(api.suppliers.ensureDemoSuppliers);
  const computeAllocation = useMutation(api.allocations.computeAllocation);
  const approvePlan = useAction(api.actions.awards.approvePlanAndSendNotices);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showNewIncident, setShowNewIncident] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    void ensureDemoSuppliers({}).catch(() => {
      // Supplier loading remains usable even if starter data cannot be prepared.
    });
  }, [ensureDemoSuppliers, isAuthenticated]);

  useEffect(() => {
    if (signingOut && !authLoading && !isAuthenticated) setSigningOut(false);
  }, [authLoading, isAuthenticated, signingOut]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setSelectedIncidentId(null);
    setSelectedNeedId(null);
    setIncidentSearch("");
    setStepOverride(null);
    setShowNewIncident(false);
    setBusy(false);
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    try {
      await signOut();
    } catch (cause) {
      setSigningOut(false);
      showToast(userFacingError(cause, "Could not sign out"));
    }
  };

  const openStep = (step: WorkspaceFlowStep) => {
    if (!flowStepAvailable(step, flowArgs)) return;
    setStepOverride(step);
  };

  const handleCreateRequirement = async (values: any) => {
    const deadlineAt = new Date(values.deadlineLocal).getTime();
    const { incidentId, needIds } = await createRequirement({
      title: values.title,
      description: values.description || undefined,
      deadlineAt,
      certification: values.certification || undefined,
      evidenceKey: values.evidenceKey || undefined,
      deliveryLocation: values.deliveryLocation,
      timezone: values.timezone,
      items: values.items.map((line: any) => ({
        item: line.item,
        qty: line.qty,
        budgetCents: Math.round(line.budgetDollars * 100),
      })),
    });
    setSelectedIncidentId(incidentId);
    setSelectedNeedId(needIds[0]);
    setStepOverride("suppliers");
    setShowNewIncident(false);
    showToast(values.items.length > 1
      ? `${values.items.length} requests created — build the first shortlist`
      : "Requirement created — build the supplier shortlist");
  };

  const handleRecompute = async () => {
    if (!activeNeed) return;
    setBusy(true);
    try {
      await computeAllocation({ needId: activeNeed._id });
      showToast("Recommendation recomputed");
    } catch (cause) {
      showToast(userFacingError(cause, "Could not recompute the recommendation"));
    } finally {
      setBusy(false);
    }
  };

  const canApprove = Boolean(latestPlan && approvalReadiness.ready && recommendationState === "ready" && !busy);

  const handleApprove = async () => {
    if (!latestPlan || !canApprove) return;
    setBusy(true);
    try {
      const result = await approvePlan({ planId: latestPlan._id });
      showToast(awardDispatchMessage(result));
    } catch (cause) {
      showToast(userFacingError(cause, "Could not approve the recommendation"));
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

  if (authLoading || signingOut) {
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

  if (window.location.pathname === "/report") return <DecisionReport />;

  if (incidentQuery === undefined) {
    return <div className="grid h-dvh place-items-center bg-paper text-soft">Loading workspace…</div>;
  }

  if (allIncidents.length === 0) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
        <AppHeader
          subtitle="Evidence-backed supplier coordination"
          email={currentUser?.email}
          onSignOut={() => void handleSignOut()}
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
      title: "Shortlist",
      detail: threads.length
        ? `${threads.length} shortlisted${sentThreadCount ? ` · ${sentThreadCount} contacted` : " · ready for review"}`
        : "Start with a saved vendor",
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
        : recommendationState === "approved"
          ? "Plan approved"
          : recommendationState === "infeasible"
            ? "No feasible recommendation — resolve quote issues"
            : recommendationState === "stale"
              ? "Recommendation changed — recompute before approval"
              : "Review the recommendation and approve",
    },
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <AppHeader
        narrow
        subtitle="Supplier quote emails, compared and approved"
        email={currentUser?.email}
        onSignOut={() => void handleSignOut()}
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
                    Build supplier shortlist
                  </button>
                ) : null}
              </>
            ),
            suppliers: (
              <>
                <SupplierOutreach key={activeNeed?._id} needId={activeNeed?._id} suppliers={suppliers} threads={threads} />
                {available.quotes ? (
                  <button
                    type="button"
                    onClick={() => openStep("quotes")}
                    className="w-full rounded-lg border border-hairline bg-sheet px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
                  >
                    Continue to quotes
                  </button>
                ) : (
                  <p className="text-sm text-soft">Shortlist at least one supplier for this requirement before moving to quotes.</p>
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
                    suppliers={relevantSuppliers}
                    need={activeNeed}
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
                {activeNeed ? <AllocationInspector plan={latestPlan} need={activeNeed} state={recommendationState} blockedReason={approvalReadiness.reason} /> : null}
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
                        disabled={!canApprove}
                        title={canApprove ? undefined : approvalReadiness.reason}
                        className="w-full rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white hover:bg-ledger-deep disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {recommendationState === "approved" ? "Plan approved" : canApprove ? "Approve plan" : "Approval unavailable"}
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
                    {canApprove
                      ? "Full coverage is current. Review the recommendation before supplier notices go out."
                      : approvalReadiness.reason}
                  </p>
                </div>
                <details className="rounded-[10px] border border-hairline bg-sheet">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-ink">Advanced</summary>
                  <div className="space-y-3 border-t border-hairline p-3">
                    {latestPlan && (recommendationState === "ready" || recommendationState === "approved") ? <AuditReceipt need={activeNeed} plan={latestPlan} /> : null}
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
