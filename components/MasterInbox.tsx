"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Reply, Notification, AIAnalysis, WORKSPACES } from "@/lib/mock-data";
import { analyzeReply } from "@/lib/ai-analysis";
import { ReplyList } from "@/components/ReplyList";
import { ReplyDetail } from "@/components/ReplyDetail";
import { EmptyState } from "@/components/EmptyState";
import { NotificationFeed } from "@/components/NotificationFeed";
import { ReplyDashboard } from "@/components/ReplyDashboard";
import { CampaignHealth } from "@/components/CampaignHealth";
import { LeadProgress } from "@/components/LeadProgress";
import { Inbox, Bell, BarChart2, RefreshCw, Activity, TrendingUp } from "lucide-react";

type View = "inbox" | "notifications" | "dashboard" | "campaigns" | "pipeline";

function dbRowToReply(r: any): Reply {
  const workspace = WORKSPACES.find(w => w.slug === r.workspaceSlug || w.id === r.workspaceId);
  return {
    id:           r.id,
    workspaceId:  workspace?.id ?? r.workspaceId ?? "w1",
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

function replyToNotification(reply: Reply, aiAnalysis?: AIAnalysis): Notification {
  return {
    id:          `notif-${reply.id}`,
    replyId:     reply.id,
    workspaceId: reply.workspaceId,
    event:       "reply_received",
    leadName:    reply.leadName,
    leadEmail:   reply.leadEmail,
    campaign:    reply.campaign,
    snippet:     reply.message.slice(0, 100),
    message:     reply.message,
    receivedAt:  reply.receivedAt,
    read:        reply.status !== "new",
    aiAnalysis,
  };
}

export function MasterInbox() {
  const [view, setView]                   = useState<View>("notifications");
  const [replies, setReplies]             = useState<Reply[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [search, setSearch]               = useState("");
  const [filterStatus, setFilterStatus]       = useState("all");
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [aiCache, setAiCache]             = useState<Record<string, AIAnalysis>>({});
  const [loading, setLoading]             = useState(true);
  const [lastRefresh, setLastRefresh]     = useState<Date>(new Date());

  const analyzedIds = useRef<Set<string>>(new Set());

  const selectedReply   = selectedId ? replies.find(r => r.id === selectedId) ?? null : null;
  const unreadCount     = notifications.filter(n => !n.read).length;
  const newRepliesCount = replies.filter(r => r.status === "new").length;

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

      const mapped = rows.map(dbRowToReply);

      setReplies(prev => {
        return mapped.map((r: Reply) => {
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
        });
      });

      setNotifications(prev => {
        return mapped.map((r: Reply) => {
          const existing = prev.find(p => p.replyId === r.id);
          const aiAnalysis = dbCache[r.id] ?? existing?.aiAnalysis;
          const notif = replyToNotification(r, aiAnalysis);
          return notif;
        });
      });

      setLastRefresh(new Date());
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
            reply.id,
            reply.leadName,
            reply.leadEmail,
            reply.campaign,
            reply.message
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
    setNotifications(prev =>
      prev.map(n => n.replyId === id ? { ...n, read: false, aiAnalysis: undefined } : n)
    );
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

  function handleMarkRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }

  function handleMarkAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function handleOpenReply(replyId: string) {
    setView("inbox");
    setSelectedId(replyId);
  }

  function handleAIAnalyzed(replyId: string, analysis: AIAnalysis) {
    setAiCache(prev => ({ ...prev, [replyId]: analysis }));
    setNotifications(prev =>
      prev.map(n => n.replyId === replyId ? { ...n, aiAnalysis: analysis } : n)
    );
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

  function handleUpdateNotification(id: string, updates: Partial<Notification>) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    if (updates.aiAnalysis) {
      const n = notifications.find(x => x.id === id);
      if (n) handleAIAnalyzed(n.replyId, updates.aiAnalysis);
    }
  }

  const NAV: { id: View; label: string; icon: React.ElementType; badge: number }[] = [
    { id: "notifications", label: "Notifications", icon: Bell,       badge: unreadCount },
    { id: "inbox",         label: "Inbox",          icon: Inbox,      badge: newRepliesCount },
    { id: "dashboard",     label: "Dashboard",      icon: BarChart2,  badge: 0 },
    { id: "campaigns",     label: "Campaigns",      icon: Activity,   badge: 0 },
    { id: "pipeline",      label: "Pipeline",       icon: TrendingUp, badge: 0 },
  ];

  return (
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
        {view === "notifications" && (
          <NotificationFeed
            notifications={notifications}
            onMarkRead={handleMarkRead}
            onMarkAllRead={handleMarkAllRead}
            onOpenReply={handleOpenReply}
            onUpdateNotification={handleUpdateNotification}
          />
        )}

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

        {view === "dashboard" && (
          <ReplyDashboard />
        )}

        {view === "campaigns" && (
          <CampaignHealth />
        )}

        {view === "pipeline" && (
          <LeadProgress />
        )}
      </div>
    </div>
  );
}