"use client";

import { useState } from "react";
import { Notification, WORKSPACES } from "@/lib/mock-data";
import { analyzeReply, INTENT_CONFIG, URGENCY_ORDER } from "@/lib/ai-analysis";
import { AIBadge } from "@/components/AIBadge";
import { timeAgo } from "@/lib/utils";
import {
  Bell, CheckCheck, MessageSquare, ThumbsUp,
  ThumbsDown, Send, Eye, Sparkles, Loader2,
} from "lucide-react";

interface Props {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenReply: (replyId: string) => void;
  onUpdateNotification: (id: string, updates: Partial<Notification>) => void;
}

const EVENT_CONFIG = {
  reply_received:        { label: "Replied",       icon: MessageSquare, dot: "#3b82f6" },
  marked_interested:     { label: "Interested",    icon: ThumbsUp,      dot: "#10b981" },
  marked_not_interested: { label: "Not interested",icon: ThumbsDown,    dot: "#ef4444" },
  reply_sent:            { label: "Replied by you",icon: Send,          dot: "#8b5cf6" },
} as const;

export function NotificationFeed({
  notifications, onMarkRead, onMarkAllRead, onOpenReply, onUpdateNotification,
}: Props) {
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [showRead, setShowRead] = useState(false);
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  const filtered = notifications
    .filter((n) => {
      if (filterWorkspace !== "all" && n.workspaceId !== filterWorkspace) return false;
      if (!showRead && n.read) return false;
      return true;
    })
    .sort((a, b) => {
      const aOrder = a.aiAnalysis ? URGENCY_ORDER[a.aiAnalysis.intent] : 99;
      const bOrder = b.aiAnalysis ? URGENCY_ORDER[b.aiAnalysis.intent] : 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.receivedAt.getTime() - a.receivedAt.getTime();
    });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const analyzedCount = notifications.filter((n) => n.aiAnalysis).length;
  const anyAnalyzing = Object.values(analyzing).some(Boolean);

  async function handleAnalyze(n: Notification) {
    if (analyzing[n.id] || n.aiAnalysis) return;
    setAnalyzing((p) => ({ ...p, [n.id]: true }));
    try {
      const analysis = await analyzeReply(n.leadName, n.leadEmail, n.campaign, n.snippet);
      onUpdateNotification(n.id, { aiAnalysis: analysis });
    } catch (err) {
      console.error("AI analysis failed:", err);
    } finally {
      setAnalyzing((p) => ({ ...p, [n.id]: false }));
    }
  }

  async function handleAnalyzeAll() {
    const unanalyzed = notifications.filter(
      (n) => !n.aiAnalysis && !analyzing[n.id] && n.event === "reply_received"
    );
    for (const n of unanalyzed) await handleAnalyze(n);
  }

  function getGroup(date: Date): string {
    const hrs = (Date.now() - date.getTime()) / 3600000;
    if (hrs < 1) return "Last hour";
    if (hrs < 24) return "Today";
    if (hrs < 48) return "Yesterday";
    return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  }

  const urgentItems = filtered.filter(
    (n) => n.aiAnalysis && (n.aiAnalysis.intent === "interested_urgent" || n.aiAnalysis.intent === "interested")
  );
  const otherItems = filtered.filter((n) => !urgentItems.includes(n));

  type Group = { label: string; items: Notification[]; isUrgent?: boolean };
  const groups: Group[] = [];
  if (urgentItems.length > 0) {
    groups.push({ label: "AI flagged — action needed", items: urgentItems, isUrgent: true });
  }
  otherItems.forEach((n) => {
    const label = getGroup(n.receivedAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(n);
    else groups.push({ label, items: [n] });
  });

  const activeWorkspaceIds = [...new Set(notifications.map((n) => n.workspaceId))];
  const activeWorkspaces = WORKSPACES.filter((w) => activeWorkspaceIds.includes(w.id));

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f8f7f5" }}>
      {/* Header */}
      <div className="px-6 pt-5 pb-4 shrink-0" style={{ background: "#ffffff", borderBottom: "1px solid #ede9e3" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-900">Notifications</h1>
            {unreadCount > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "#eff6ff", color: "#1a56db" }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAnalyzeAll}
              disabled={anyAnalyzing}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                background: "#faf5ff", color: anyAnalyzing ? "#a78bfa" : "#7c3aed",
                border: "1px solid #ddd6fe",
                cursor: anyAnalyzing ? "not-allowed" : "pointer",
              }}
            >
              {anyAnalyzing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {anyAnalyzing ? "Analyzing..." : `AI analyze${analyzedCount > 0 ? ` (${analyzedCount} done)` : " all"}`}
            </button>
            <button
              onClick={() => setShowRead((p) => !p)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                background: showRead ? "#f1f5f9" : "transparent",
                color: showRead ? "#374151" : "#9ca3af",
                border: "1px solid #e5e7eb",
              }}
            >
              <Eye size={11} />
              {showRead ? "Hide read" : "Show read"}
            </button>
            {unreadCount > 0 && (
              <button onClick={onMarkAllRead}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg"
                style={{ color: "#1a56db", border: "1px solid #bfdbfe", background: "#eff6ff" }}>
                <CheckCheck size={11} />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Workspace filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setFilterWorkspace("all")}
            className="text-[11px] px-2.5 py-1 rounded-full transition-colors"
            style={{
              background: filterWorkspace === "all" ? "#1a56db" : "#f1f5f9",
              color: filterWorkspace === "all" ? "#ffffff" : "#6b7280",
              fontWeight: filterWorkspace === "all" ? 600 : 400,
            }}>
            All workspaces
          </button>
          {activeWorkspaces.map((w) => {
            const hasUnread = notifications.some((n) => n.workspaceId === w.id && !n.read);
            const isActive = filterWorkspace === w.id;
            return (
              <button key={w.id}
                onClick={() => setFilterWorkspace(isActive ? "all" : w.id)}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: isActive ? w.color + "18" : "#f1f5f9",
                  color: isActive ? w.color : "#6b7280",
                  border: isActive ? `1px solid ${w.color}44` : "1px solid transparent",
                  fontWeight: isActive ? 600 : 400,
                }}>
                {hasUnread && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.color }} />
                )}
                {w.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
              <Bell size={16} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-400">
              {showRead ? "No notifications" : "You're all caught up"}
            </p>
          </div>
        ) : (
          <div className="space-y-5 max-w-2xl">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: group.isUrgent ? "#dc2626" : "#9ca3af" }}>
                    {group.isUrgent ? "⚡ " : ""}{group.label}
                  </span>
                  <div className="flex-1 h-px"
                    style={{ background: group.isUrgent ? "#fecaca" : "#ede9e3" }} />
                </div>

                <div className="space-y-1.5">
                  {groups.map(() => null) /* satisfy linter */ && null}
                  {group.items.map((n) => {
                    const ws = WORKSPACES.find((w) => w.id === n.workspaceId)!;
                    const cfg = EVENT_CONFIG[n.event];
                    const Icon = cfg.icon;
                    const isAnalyzing = analyzing[n.id];
                    const ai = n.aiAnalysis;
                    const intentCfg = ai ? INTENT_CONFIG[ai.intent] : null;

                    return (
                      // ── Outer wrapper is a DIV, not a button ──────────────
                      <div
                        key={n.id}
                        className="rounded-xl transition-all overflow-hidden"
                        style={{
                          background: n.read ? "transparent" : "#ffffff",
                          border: n.read ? "1px solid transparent"
                            : group.isUrgent ? "1px solid #fca5a5"
                            : "1px solid #ede9e3",
                          opacity: n.read ? 0.55 : 1,
                          boxShadow: group.isUrgent && !n.read
                            ? "0 2px 8px rgba(239,68,68,0.08)"
                            : n.read ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                      >
                        {/* AI summary bar */}
                        {ai && !n.read && (
                          <div
                            className="flex items-center justify-between gap-2 px-3.5 py-2"
                            style={{
                              background: intentCfg!.bg,
                              borderBottom: `1px solid ${intentCfg!.border}`,
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <AIBadge intent={ai.intent} />
                              <span className="text-[11px] truncate" style={{ color: intentCfg!.color }}>
                                {ai.summary}
                              </span>
                            </div>
                            <span className="text-[10px] shrink-0" style={{ color: intentCfg!.color }}>
                              {ai.suggestedTemplateId && (
                                <>Template: {{
                                  t1: "Schedule call", t2: "Send deck", t3: "More info",
                                  t4: "Decline", t5: "Follow up", t6: "Confirm",
                                }[ai.suggestedTemplateId]}</>
                              )}
                            </span>
                          </div>
                        )}

                        {/* Card body — clickable div, not button */}
                        <div
                          className="flex items-start gap-3 px-3.5 py-3 cursor-pointer group"
                          role="button"
                          tabIndex={0}
                          onClick={() => { onMarkRead(n.id); onOpenReply(n.replyId); }}
                          onKeyDown={(e) => e.key === "Enter" && (onMarkRead(n.id), onOpenReply(n.replyId))}
                          onMouseEnter={(e) => {
                            if (!n.read) (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = "#cbd5e1";
                          }}
                          onMouseLeave={(e) => {
                            if (!n.read && !group.isUrgent) (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = "#ede9e3";
                            if (!n.read && group.isUrgent) (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = "#fca5a5";
                          }}
                        >
                          {/* Workspace avatar */}
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5"
                            style={{
                              background: ws.color + "18",
                              color: ws.color,
                              border: `1.5px solid ${ws.color}30`,
                            }}
                          >
                            {ws.initials}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {!n.read && (
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "#1a56db" }} />
                                )}
                                <span className="text-xs font-semibold text-gray-900 truncate">
                                  {n.leadName}
                                </span>
                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{ background: cfg.dot + "15", color: cfg.dot }}>
                                  <Icon size={9} strokeWidth={2.5} />
                                  {cfg.label}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* AI button — a real button inside a div is fine now */}
                                {n.event === "reply_received" && !ai && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAnalyze(n); }}
                                    disabled={isAnalyzing}
                                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                                    style={{
                                      background: "#faf5ff",
                                      color: isAnalyzing ? "#a78bfa" : "#7c3aed",
                                      border: "1px solid #ede9fe",
                                    }}
                                  >
                                    {isAnalyzing
                                      ? <Loader2 size={9} className="animate-spin" />
                                      : <Sparkles size={9} />}
                                    {isAnalyzing ? "..." : "AI"}
                                  </button>
                                )}
                                <span className="text-[10px] text-gray-400">
                                  {timeAgo(n.receivedAt)}
                                </span>
                              </div>
                            </div>

                            <p className="text-[11px] text-gray-400 mb-1 truncate">
                              <span style={{ color: ws.color, fontWeight: 500 }}>{ws.name}</span>
                              <span className="mx-1">·</span>
                              {n.campaign}
                            </p>

                            <p className="text-xs text-gray-600 leading-relaxed line-clamp-1">
                              {n.snippet}
                            </p>
                          </div>

                          <span className="text-gray-300 text-xs self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
