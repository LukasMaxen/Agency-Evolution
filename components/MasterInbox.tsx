"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Reply, AIAnalysis } from "@/lib/mock-data";
import { WorkspacesContext, buildWorkspaceFromRow, findWorkspace } from "@/lib/workspaces-context";
import { analyzeReply } from "@/lib/ai-analysis";
import { ReplyList } from "@/components/ReplyList";
import { ReplyDetail } from "@/components/ReplyDetail";
import { EmptyState } from "@/components/EmptyState";
import { ReplyDashboard } from "@/components/ReplyDashboard";
import { KPITracker } from "@/components/KPITracker";
import { LeadMonitoring } from "@/components/LeadMonitoring";
import { AccountMonitor } from "@/components/AccountMonitor";
import { WarmupMonitor } from "@/components/WarmupMonitor";
import { VariantRefresh } from "@/components/VariantRefresh";
import { Inbox, BarChart2, RefreshCw, ShieldAlert, RotateCcw, Users, Flame, Target } from "lucide-react";

type View = "inbox" | "dashboard" | "kpi-tracker" | "lead-monitoring" | "account-monitor" | "warmup-monitor" | "variant-refresh";

function dbRowToReply(r: any, workspaces: ReturnType<typeof buildWorkspaceFromRow>[]): Reply {
  const workspace = findWorkspace(workspaces, r.workspaceSlug ?? r.workspaceId ?? "");
  return {
    id:           r.id,
    workspaceId:  workspace.id !== "unknown" ? workspace.id : (r.workspaceId ?? "w1"),
    emailBisonId: r.emailBisonId ?? r.id,
    leadEmail:    r.leadEmail,
    leadName:     r.leadName,
    senderEmail:  r.senderEmail ?? "",
    campaign:     r.campaign ?? "",
    subject:      r.subject ?? "",
    message:      r.message,
    receivedAt:   new Date(r.receivedAt),
    status:       (r.status as "new" | "read" | "replied") ?? "new",
    interested:   r.interested ?? null,
  };
}

export function MasterInbox() {
  const [workspaces, setWorkspaces]         = useState<ReturnType<typeof buildWorkspaceFromRow>[]>([]);
  const [view, setView]                     = useState<View>("inbox");
  const [replies, setReplies]               = useState<Reply[]>([]);
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [search, setSearch]                 = useState("");
  const [filterStatus, setFilterStatus]     = useState("all");
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [aiCache, setAiCache]               = useState<Record<string, AIAnalysis>>({});
  const [loading, setLoading]               = useState(true);
  const [lastRefresh, setLastRefresh]       = useState<Date>(new Date());

  const analyzedIds = useRef<Set<string>>(new Set());

  const selectedReply   = selectedId ? replies.find(r => r.id === selectedId) ?? null : null;
  const newRepliesCount = replies.filter(r => r.status === "new").length;

  // ── Fetch workspaces from DB once on mount ────────────────────────────────
  // This is the ONLY place workspaces are loaded. The DB is the source of truth
  // (seeded from EmailBison). Any workspace added/removed in EB and synced to
  // the DB automatically appears/disappears — no changes to this file needed.
  useEffect(() => {
    fetch("/api/workspaces")
      .then(r => r.json())
      .then(data => {
        const rows = data.workspaces ?? [];
        setWorkspaces(rows.map((row: any, i: number) => buildWorkspaceFromRow(row, i)));
      })
      .catch(err => console.error("[MasterInbox] failed to fetch workspaces:", err));
  }, []);

  const fetchReplies = useCallback(async () => {
    try {
      const res = await fetch("/api/replies?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      const rows: any[] = data.replies ?? [];

      const dbCache: Record<string, AIAnalysis> = {};
      for (const row of rows) {
        if (row.aiAnalysis) {
          dbCache[row.id] = {
            ...row.aiAnalysis,
            analyzedAt: new Date(row.aiAnalysis.analyzedAt ?? Date.now()),
          };
          analyzedIds.current.add(row.id);
        }
      }

      setAiCache(prev => ({ ...dbCache, ...prev }));

      // workspaces may not be loaded yet on first fetch — use current ref value
      setWorkspaces(currentWorkspaces => {
        const mapped = rows.map((r: any) => dbRowToReply(r, currentWorkspaces));

        setReplies(prev =>
          mapped.map((r: Reply) => {
            const existing = prev.find(p => p.id === r.id);
            if (existing) {
              return {
                ...r,
                status: existing.status === "replied" ? "replied"
                      : existing.status === "read" && r.status === "new" ? "read"
                      : r.status,
                interested: existing.interested !== null ? existing.interested : r.interested,
              };
            }
            return r;
          })
        );

        setLastRefresh(new Date());
        return currentWorkspaces; // no change to workspaces
      });
    } catch (err) {
      console.error("[fetch] error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReplies(); }, [fetchReplies]);

  useEffect(() => {
    const interval = setInterval(fetchReplies, 30000);
    return () => clearInterval(interval);
  }, [fetchReplies]);

  useEffect(() => {
    const newUnanalyzed = replies.filter(
      r => r.status === "new" && !analyzedIds.current.has(r.id)
    );
    if (newUnanalyzed.length === 0) return;

    let cancelled = false;

    async function analyzeSequentially() {
      for (const reply of newUnanalyzed) {
        if (cancelled) break;
        if (analyzedIds.current.has(reply.id)) continue;
        analyzedIds.current.add(reply.id);
        try {
          const analysis = await analyzeReply(
            reply.id, reply.leadName, reply.leadEmail, reply.campaign, reply.message
          );
          if (!cancelled) {
            handleAIAnalyzed(reply.id, analysis);
            if (analysis.intent === "interested_urgent" || analysis.intent === "interested") {
              fetch("/api/replies", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: reply.id, interested: true }),
              }).catch(console.error);
            }
            if (analysis.intent === "unsubscribe") {
              fetch("/api/replies", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: reply.id, interested: false }),
              }).catch(console.error);
            }
          }
        } catch (err) {
          analyzedIds.current.delete(reply.id);
          console.error("[auto-analyze]", err);
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    analyzeSequentially();
    return () => { cancelled = true; };
  }, [replies]);

  function handleSelect(reply: Reply) {
    setSelectedId(reply.id);
    if (reply.status === "new") {
      setReplies(prev => prev.map(r => r.id === reply.id ? { ...r, status: "read" } : r));
      fetch("/api/replies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reply.id, status: "read" }),
      }).catch(console.error);
    }
  }

  function handleMarkInterested(id: string, value: boolean | null) {
    setReplies(prev => prev.map(r => r.id === id ? { ...r, interested: value } : r));
    fetch("/api/replies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, interested: value }),
    }).catch(console.error);
  }

  function handleReplySent(id: string) {
    setReplies(prev => prev.map(r => r.id === id ? { ...r, status: "replied" } : r));
  }

  function handleMarkUnread(id: string) {
    analyzedIds.current.delete(id);
    setReplies(prev => prev.map(r => r.id === id ? { ...r, status: "new" } : r));
    setAiCache(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    fetch("/api/replies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "new" }),
    }).catch(console.error);
  }

  function handleAIAnalyzed(replyId: string, analysis: AIAnalysis) {
    setAiCache(prev => ({ ...prev, [replyId]: analysis }));
    if (analysis.intent === "interested_urgent" || analysis.intent === "interested") {
      setReplies(prev =>
        prev.map(r => r.id === replyId && r.interested === null ? { ...r, interested: true } : r)
      );
    }
    if (analysis.intent === "unsubscribe") {
      setReplies(prev =>
        prev.map(r => r.id === replyId && r.interested === null ? { ...r, interested: false } : r)
      );
    }
  }

  const NAV: { id: View; label: string; icon: React.ElementType; badge: number }[] = [
    { id: "inbox",           label: "Inbox",           icon: Inbox,       badge: newRepliesCount },
    { id: "dashboard",       label: "Dashboard",       icon: BarChart2,   badge: 0 },
    { id: "kpi-tracker",     label: "KPI Tracker",     icon: Target,      badge: 0 },
    { id: "lead-monitoring", label: "Lead Monitoring", icon: Users,       badge: 0 },
    { id: "account-monitor", label: "Domain Monitor",  icon: ShieldAlert, badge: 0 },
    { id: "warmup-monitor",  label: "Warmup Monitor",  icon: Flame,       badge: 0 },
    { id: "variant-refresh", label: "Var Refresh",     icon: RotateCcw,   badge: 0 },
  ];

  return (
    // Provide DB workspaces to every child component via context.
    // No child needs to import WORKSPACES from mock-data.ts anymore.
    <WorkspacesContext.Provider value={workspaces}>
      <div className="flex h-screen overflow-hidden" style={{ background: "#f8f7f5" }}>
        {/* Sidebar */}
        <div className="w-48 shrink-0 flex flex-col py-5 px-3 gap-0.5"
          style={{ background: "#ffffff", borderRight: "1px solid #ede9e3" }}>

          <div className="px-3 mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "#1a56db" }}>
                <span className="text-white text-[10px] font-bold tracking-tight">AI</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-900 leading-none">AI Reply Desk</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-none">by Agency Evolution</p>
              </div>
            </div>
          </div>

          {NAV.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} onClick={() => setView(id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all"
              style={{
                background: view === id ? "#eff6ff" : "transparent",
                color: view === id ? "#1a56db" : "#6b7280",
              }}
            >
              <Icon size={15} strokeWidth={view === id ? 2.2 : 1.8} />
              <span className="text-xs flex-1" style={{ fontWeight: view === id ? 600 : 400 }}>
                {label}
              </span>
              {badge > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                  style={{
                    background: view === id ? "#1a56db" : "#e5e7eb",
                    color: view === id ? "#ffffff" : "#374151",
                  }}>
                  {badge}
                </span>
              )}
            </button>
          ))}

          <div className="mt-auto px-3 pb-2">
            <div className="flex items-center gap-1.5">
              <RefreshCw size={10} className="text-gray-300" />
              <span className="text-[10px] text-gray-300" suppressHydrationWarning>
                {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {view === "inbox" && (
            <>
              <ReplyList
                replies={replies}
                selectedId={selectedId}
                search={search}
                filterStatus={filterStatus}
                filterWorkspace={filterWorkspace}
                onSelect={handleSelect}
                onSearchChange={setSearch}
                onStatusChange={setFilterStatus}
                onWorkspaceChange={setFilterWorkspace}
              />
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-gray-400">Loading replies...</p>
                </div>
              ) : selectedReply ? (
                <ReplyDetail
                  key={selectedReply.id}
                  reply={selectedReply}
                  aiAnalysis={aiCache[selectedReply.id]}
                  onMarkInterested={handleMarkInterested}
                  onReplySent={handleReplySent}
                  onAIAnalyzed={handleAIAnalyzed}
                  onMarkUnread={handleMarkUnread}
                />
              ) : (
                <EmptyState />
              )}
            </>
          )}

          {view === "dashboard" && <ReplyDashboard />}
          {view === "kpi-tracker" && <KPITracker />}
          {view === "lead-monitoring" && <LeadMonitoring />}
          {view === "account-monitor" && <AccountMonitor />}
          {view === "warmup-monitor" && <WarmupMonitor />}
          {view === "variant-refresh" && <VariantRefresh />}
        </div>
      </div>
    </WorkspacesContext.Provider>
  );
}