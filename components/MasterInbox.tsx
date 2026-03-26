"use client";

import { useState } from "react";
import { MOCK_REPLIES, MOCK_NOTIFICATIONS, Reply, Notification, AIAnalysis } from "@/lib/mock-data";
import { ReplyList } from "@/components/ReplyList";
import { ReplyDetail } from "@/components/ReplyDetail";
import { EmptyState } from "@/components/EmptyState";
import { NotificationFeed } from "@/components/NotificationFeed";
import { ReplyDashboard } from "@/components/ReplyDashboard";
import { Inbox, Bell, BarChart2 } from "lucide-react";

type View = "inbox" | "notifications" | "dashboard";

export function MasterInbox() {
  const [view, setView] = useState<View>("notifications");
  const [replies, setReplies] = useState<Reply[]>(MOCK_REPLIES);
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [aiCache, setAiCache] = useState<Record<string, AIAnalysis>>({});

  const selectedReply = selectedId ? replies.find((r) => r.id === selectedId) ?? null : null;
  const unreadCount = notifications.filter((n) => !n.read).length;
  const newRepliesCount = replies.filter((r) => r.status === "new").length;

  function handleSelect(reply: Reply) {
    setSelectedId(reply.id);
    if (reply.status === "new") {
      setReplies((prev) =>
        prev.map((r) => (r.id === reply.id ? { ...r, status: "read" } : r))
      );
    }
  }

  function handleMarkInterested(id: string, value: boolean | null) {
    setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, interested: value } : r)));
  }

  function handleReplySent(id: string) {
    setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, status: "replied" } : r)));
  }

  function handleMarkRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function handleOpenReply(replyId: string) {
    setView("inbox");
    const reply = replies.find((r) => r.id === replyId);
    if (reply) handleSelect(reply);
  }

  function handleAIAnalyzed(replyId: string, analysis: AIAnalysis) {
    setAiCache((prev) => ({ ...prev, [replyId]: analysis }));
    setNotifications((prev) =>
      prev.map((n) => (n.replyId === replyId ? { ...n, aiAnalysis: analysis } : n))
    );
    if (analysis.intent === "interested_urgent" || analysis.intent === "interested") {
      setReplies((prev) =>
        prev.map((r) => (r.id === replyId && r.interested === null ? { ...r, interested: true } : r))
      );
    }
    if (analysis.intent === "unsubscribe") {
      setReplies((prev) =>
        prev.map((r) => (r.id === replyId && r.interested === null ? { ...r, interested: false } : r))
      );
    }
  }

  function handleUpdateNotification(id: string, updates: Partial<Notification>) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updates } : n))
    );
    if (updates.aiAnalysis) {
      const n = notifications.find((x) => x.id === id);
      if (n) handleAIAnalyzed(n.replyId, updates.aiAnalysis);
    }
  }

  const NAV: { id: View; label: string; icon: React.ElementType; badge: number }[] = [
    { id: "notifications", label: "Notifications", icon: Bell,      badge: unreadCount },
    { id: "inbox",         label: "Inbox",          icon: Inbox,     badge: newRepliesCount },
    { id: "dashboard",     label: "Dashboard",      icon: BarChart2, badge: 0 },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f8f7f5" }}>
      {/* Sidebar */}
      <div className="w-48 shrink-0 flex flex-col py-5 px-3 gap-0.5"
        style={{ background: "#ffffff", borderRight: "1px solid #ede9e3" }}>
        {/* Brand */}
        <div className="px-3 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "#1a56db" }}>
              <span className="text-white text-[10px] font-bold tracking-tight">AI</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-900 leading-none">AI Reply Desk</p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-none">by PalcoLabs</p>
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
            {selectedReply ? (
              <ReplyDetail
                key={selectedReply.id}
                reply={selectedReply}
                aiAnalysis={aiCache[selectedReply.id]}
                onMarkInterested={handleMarkInterested}
                onReplySent={handleReplySent}
                onAIAnalyzed={handleAIAnalyzed}
              />
            ) : (
              <EmptyState />
            )}
          </>
        )}

        {view === "dashboard" && (
          <ReplyDashboard />
        )}
      </div>
    </div>
  );
}