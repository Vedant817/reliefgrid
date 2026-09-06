import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function DemoBulletin() {
  const bulletinId = new URLSearchParams(window.location.search).get("id");
  const bulletin = useQuery(
    api.evidenceDrift.getPublicBulletin,
    bulletinId ? { bulletinId: bulletinId as any } : "skip",
  );
  const recalled = bulletin?.state === "RECALL_ACTIVE";

  return (
    <main className="min-h-screen bg-[#f4f1e8] text-[#172019] p-6 md:p-14">
      <div className="max-w-3xl mx-auto border-[3px] border-[#172019] bg-white shadow-[10px_10px_0_#172019]">
        <header className="p-5 border-b-[3px] border-[#172019] flex justify-between gap-4">
          <div className="font-black tracking-tight text-xl">NORTHSTAR SAFETY BULLETINS</div>
          <div className="font-mono text-xs">PUBLIC DEMO SOURCE</div>
        </header>
        <div className="p-6 md:p-10">
          <div className={`inline-block border-2 border-[#172019] px-3 py-1 font-black font-mono ${recalled ? "bg-[#ff4d35]" : "bg-[#b7f36b]"}`}>
            {bulletinId ? bulletin?.state ?? "LOADING" : "NOT FOUND"}
          </div>
          <h1 className="mt-6 text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.95]">{bulletinId ? bulletin?.title ?? "Loading bulletin" : "Bulletin not found"}</h1>
          <p className="mt-8 text-lg leading-relaxed">{bulletin?.body}</p>
          <div className="mt-10 pt-5 border-t-2 border-[#172019] font-mono text-xs flex justify-between">
            <span>KEY: filter-nsf53</span>
            <span>{bulletin ? new Date(bulletin.updatedAt).toISOString() : ""}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
