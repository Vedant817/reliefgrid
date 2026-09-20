import type { ReactNode } from "react";
import {
  WORKSPACE_FLOW_STEPS,
  type WorkspaceFlowStep,
} from "../lib/outreach";

type StepSummary = { title: string; detail: string };

export function WorkspaceFlow({
  derivedStep,
  activeStep,
  available,
  summaries,
  onSelectStep,
  hint,
  children,
}: {
  derivedStep: WorkspaceFlowStep;
  activeStep: WorkspaceFlowStep;
  available: Record<WorkspaceFlowStep, boolean>;
  summaries: Record<WorkspaceFlowStep, StepSummary>;
  onSelectStep: (step: WorkspaceFlowStep) => void;
  hint: string;
  children: Record<WorkspaceFlowStep, ReactNode>;
}) {
  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6">
      <nav aria-label="Workspace steps" className="flex flex-wrap gap-2">
        {WORKSPACE_FLOW_STEPS.map((step, index) => {
          const isActive = activeStep === step.id;
          const isNext = derivedStep === step.id;
          const canOpen = available[step.id];
          return (
            <button
              key={step.id}
              type="button"
              disabled={!canOpen}
              aria-current={isActive ? "step" : undefined}
              onClick={() => onSelectStep(step.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                isActive
                  ? "border-ledger bg-[#eaf2ed] text-ledger-deep"
                  : canOpen
                    ? "border-hairline bg-sheet text-ink hover:bg-paper"
                    : "border-hairline bg-sheet text-soft"
              }`}
            >
              <span className="tabular-nums text-soft">{index + 1}</span>
              <span>{step.label}</span>
              {isNext ? (
                <span className="rounded-[3px] bg-ledger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  NEXT
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <p className="mt-3 text-sm text-soft">{hint}</p>

      <div className="mt-6 space-y-3">
        {WORKSPACE_FLOW_STEPS.map((step) => {
          if (step.id === activeStep) {
            return (
              <section key={step.id} aria-label={step.label} className="space-y-4">
                {children[step.id]}
              </section>
            );
          }
          const canOpen = available[step.id];
          return (
            <button
              key={step.id}
              type="button"
              disabled={!canOpen}
              onClick={() => onSelectStep(step.id)}
              className={`w-full rounded-[10px] border border-hairline bg-sheet px-4 py-3 text-left ${canOpen ? "hover:bg-paper" : "cursor-default opacity-60"}`}
            >
              <div className="text-sm font-semibold text-ink">{summaries[step.id].title}</div>
              <div className="mt-0.5 text-xs text-soft">{summaries[step.id].detail}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
