import { useState } from "react";
import { useAction, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getSessionAlias } from "../lib/session";

function messageText(m: any): string {
  if (typeof m.text === "string" && m.text) return m.text;
  const parts = m.message?.content;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p: any) => {
      if (typeof p.text === "string") return p.text;
      if (p.output !== undefined) return "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function CoordinatorChat({ needId }: { needId?: any }) {
  const alias = getSessionAlias();
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("reliefgrid-agent-thread");
    } catch {
      return null;
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = useAction(api.coordinator.askCoordinator);
  const { results } = usePaginatedQuery(
    api.agentViews.listAgentMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 20 },
  );
  const visible = (results ?? []).filter((m: any) => messageText(m)).slice(-20);

  const send = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    try {
      const contextual = needId ? `[Active need ${needId}] ${text}` : text;
      const res = await ask({ userId: alias, threadId: threadId ?? undefined, prompt: contextual });
      setThreadId(res.threadId);
      try {
        localStorage.setItem("reliefgrid-agent-thread", res.threadId);
      } catch {
        /* private mode */
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-[#111827] border border-[#1e2d4a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between">
        <div>
          <div className="text-xs tracking-[0.14em] uppercase text-slate-400">Coordinator assistant</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Answers from live records · never guesses</div>
        </div>
        <span className="text-[10px] mono px-2 py-1 rounded-full border border-violet-400/20 bg-violet-400/10 text-violet-300">AGENT</span>
      </div>
      <div className="p-4">
        <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
          {!visible.length && (
            <div className="text-xs text-slate-500">
              Ask about coverage, suppliers, verification, or history
              {needId ? " for this need" : ""}. Try “what is our coverage shortfall?”.
            </div>
          )}
          {visible.map((m: any) => (
            <div key={m._id} className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${m.message?.role === "user" ? "bg-[#1a2332] text-slate-200 ml-6" : "bg-cyan-400/5 border border-cyan-400/10 text-slate-300 mr-6"}`}>
              <span className="mono text-[10px] text-slate-500 block">{m.message?.role === "user" ? "you" : "coordinator"}</span>
              {messageText(m)}
            </div>
          ))}
          {busy && <div className="text-xs text-slate-500">Thinking with live tools…</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send(input)}
            placeholder="Ask about this operation…"
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-xl bg-[#0f172a] border border-[#1e2d4a] text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/40 disabled:opacity-50"
          />
          <button onClick={() => void send(input)} disabled={busy || !input.trim()} className="px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-xs font-semibold disabled:opacity-40">
            Ask
          </button>
        </div>
      </div>
    </section>
  );
}
