"use client";

import { useState, useRef, useEffect } from "react";
import { Reply, AIAnalysis } from "@/lib/mock-data";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";
import { analyzeReply, INTENT_CONFIG } from "@/lib/ai-analysis";
import { AIBadge } from "@/components/AIBadge";
import { CalendlySlotPicker } from "@/components/CalendlySlotPicker";
import { getInitials, timeAgo, buildEmailBisonUrl } from "@/lib/utils";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import {
  ExternalLink, ChevronDown, LayoutTemplate,
  Send, CheckCircle, XCircle, Check, Sparkles,
  Loader2, Calendar, MailOpen, CalendarCheck,
  CornerUpLeft, Bot, User,
} from "lucide-react";
import { CallBookingModal } from "@/components/CallBookingModal";

interface EBTemplate {
  id: number;
  name: string;
  body: string;
}

interface SentEmail {
  id: string;
  emailType: string;
  subject: string;
  body: string;
  sentAt: string;
  sentBy: string | null;
}

interface Props {
  reply: Reply;
  aiAnalysis?: AIAnalysis;
  onMarkInterested: (id: string, value: boolean | null) => void;
  onReplySent: (id: string) => void;
  onAIAnalyzed?: (replyId: string, analysis: AIAnalysis) => void;
  onMarkUnread?: (id: string) => void;
}

// Strip HTML tags — convert to plain text for composer
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Resolve EmailBison merge tags with real lead data
function resolveMergeTags(body: string, reply: Reply): string {
  const firstName = reply.leadName.split(" ")[0] ?? reply.leadName;
  const lastName  = reply.leadName.split(" ").slice(1).join(" ") ?? "";
  return body
    .replace(/\{FIRST_NAME\}/gi,     firstName)
    .replace(/\{LAST_NAME\}/gi,      lastName)
    .replace(/\{FULL_NAME\}/gi,      reply.leadName)
    .replace(/\{EMAIL\}/gi,          reply.leadEmail)
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi,  lastName);
}

export function ReplyDetail({
  reply, aiAnalysis: initialAI,
  onMarkInterested, onReplySent, onAIAnalyzed, onMarkUnread,
}: Props) {
  const [replyText, setReplyText]               = useState("");
  const [templates, setTemplates]               = useState<EBTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EBTemplate | null>(null);
  const [templateOpen, setTemplateOpen]         = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sending, setSending]                   = useState(false);
  const [sent, setSent]                         = useState(false);
  const [aiAnalysis, setAiAnalysis]             = useState<AIAnalysis | undefined>(initialAI);
  const [analyzing, setAnalyzing]               = useState(false);
  const [showCalendly, setShowCalendly]         = useState(false);
  const [showCallModal, setShowCallModal]       = useState(false);
  const [calls, setCalls]                       = useState<any[]>([]);
  const [meetingBooked, setMeetingBooked]       = useState(false);
  const [sentEmails, setSentEmails]             = useState<SentEmail[]>([]);
  const [sentEmailsLoading, setSentEmailsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
const workspaces = useWorkspaces();
  const workspace = findWorkspace(workspaces, reply.workspaceId);
  const emailBisonUrl = buildEmailBisonUrl(workspace.instanceUrl, reply.emailBisonId);

  useEffect(() => {
    setReplyText("");
    setSelectedTemplate(null);
    setTemplateOpen(false);
    setSent(false);
    setAiAnalysis(initialAI);
    setShowCalendly(false);
    setShowCallModal(false);
    setTemplates([]);
    setMeetingBooked((reply as any).meetingBooked ?? false);
    // Fetch call history for this reply
    fetch(`/api/calls?replyId=${reply.id}`)
      .then(r => r.json())
      .then(d => setCalls(d.calls ?? []))
      .catch(() => setCalls([]));
    // Fetch sent emails for this reply
    fetchSentEmails(reply.id);
  }, [reply.id]);

  async function fetchSentEmails(replyId: string) {
    setSentEmailsLoading(true);
    setSentEmails([]);
    try {
      const res = await fetch(`/api/sent-replies?replyId=${replyId}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSentEmails(data.sentEmails ?? []);
    } catch {
      setSentEmails([]);
    } finally {
      setSentEmailsLoading(false);
    }
  }

  async function loadTemplates() {
    if (templates.length > 0) return;
    setTemplatesLoading(true);
    try {
      const res = await fetch(`/api/templates?workspace=${workspace.slug}`);
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err) {
      console.error("[templates]", err);
    } finally {
      setTemplatesLoading(false);
    }
  }

  function toggleTemplateOpen() {
    const next = !templateOpen;
    setTemplateOpen(next);
    if (next) loadTemplates();
  }

  async function runAI() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const analysis = await analyzeReply(
        reply.id, reply.leadName, reply.leadEmail, reply.campaign, reply.message
      );
      setAiAnalysis(analysis);
      onAIAnalyzed?.(reply.id, analysis);
      applyAIResult(analysis);
    } catch (err) {
      console.error("AI error:", err);
    } finally {
      setAnalyzing(false);
    }
  }

  function applyAIResult(analysis: AIAnalysis) {
    if (analysis.suggestedReply) {
      setReplyText(analysis.suggestedReply);
    }
    if (analysis.intent === "interested_urgent" || analysis.intent === "interested") {
      setShowCalendly(true);
    }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pickTemplate(t: EBTemplate) {
    setSelectedTemplate(t);
    // Strip HTML first, then resolve merge tags
    setReplyText(resolveMergeTags(htmlToPlainText(t.body), reply));
    setTemplateOpen(false);
    textareaRef.current?.focus();
  }

  async function handleSend() {
    if (!replyText.trim() || sending || sent) return;
    setSending(true);
    try {
      const res = await fetch("/api/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyId: reply.id,
          message: replyText,
          emailType: "reply",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to send");
      }

      setSent(true);
      onReplySent(reply.id);
      fetchSentEmails(reply.id);
      setTimeout(() => setSent(false), 3000);
    } catch (err: any) {
      console.error("[send]", err);
      alert(`Failed to send: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  const intentCfg = aiAnalysis ? INTENT_CONFIG[aiAnalysis.intent] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f8f7f5" }}>

      {/* AI banner */}
      {aiAnalysis && intentCfg && (
        <div
          className="px-6 py-2.5 flex items-center justify-between gap-4 shrink-0"
          style={{ background: intentCfg.bg, borderBottom: `1px solid ${intentCfg.border}` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={12} style={{ color: intentCfg.color }} />
            <AIBadge intent={aiAnalysis.intent} />
            <span className="text-[11px] truncate" style={{ color: intentCfg.color }}>
              {aiAnalysis.summary}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ background: "#ffffff", borderBottom: "1px solid #ede9e3" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold"
              style={{ background: workspace.color + "18", border: `1.5px solid ${workspace.color}30`, color: workspace.color }}
            >
              {getInitials(reply.leadName)}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{reply.leadName}</p>
              <p className="text-xs text-gray-400">{reply.leadEmail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <WorkspaceAvatar workspace={workspace} size={18} />
              <span className="text-xs font-medium" style={{ color: workspace.color }}>
                {workspace.name}
              </span>
            </div>
            <a
              href={emailBisonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors"
              style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "#ffffff" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#1a56db";
                (e.currentTarget as HTMLAnchorElement).style.color = "#1a56db";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e5e7eb";
                (e.currentTarget as HTMLAnchorElement).style.color = "#6b7280";
              }}
            >
              <ExternalLink size={11} />
              View in EmailBison
            </a>
          </div>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {[reply.campaign, `Via ${reply.senderEmail}`, timeAgo(reply.receivedAt)].map((t) => (
            <span key={t} className="text-[11px] px-2 py-0.5 rounded-md" suppressHydrationWarning
              style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Message */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {reply.subject}
        </p>

        <div className="rounded-xl p-4"
          style={{ background: "#ffffff", border: "1px solid #ede9e3", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-xs font-semibold text-gray-700">{reply.leadName}</span>
            <span className="text-[11px] text-gray-400" suppressHydrationWarning>
              {timeAgo(reply.receivedAt)}
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {reply.message}
          </p>
        </div>

        {/* Sent emails thread */}
        {sentEmailsLoading && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 size={10} className="animate-spin" style={{ color: "#9ca3af" }} />
            <span className="text-[11px] text-gray-400">Loading sent replies...</span>
          </div>
        )}

        {sentEmails.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px" style={{ background: "#ede9e3" }} />
              <span className="text-[10px] uppercase tracking-widest font-medium text-gray-300">
                {sentEmails.length} sent {sentEmails.length === 1 ? "reply" : "replies"}
              </span>
              <div className="flex-1 h-px" style={{ background: "#ede9e3" }} />
            </div>

            {sentEmails.map((se) => {
              const isAuto = se.emailType === "auto_reply";
              const sentByLabel = isAuto
                ? "AI (auto-reply)"
                : se.sentBy
                  ? se.sentBy === "dashboard"
                    ? "Sent via dashboard"
                    : se.sentBy === "claude-code"
                      ? "Sent via Claude Code"
                      : `Sent by ${se.sentBy}`
                  : "Sent manually";

              const sentAtDate = new Date(se.sentAt);
              const formattedDate = sentAtDate.toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              });
              const formattedTime = sentAtDate.toLocaleTimeString("en-US", {
                hour: "numeric", minute: "2-digit", hour12: true,
              });

              return (
                <div
                  key={se.id}
                  className="rounded-xl p-4"
                  style={{
                    background: "#f0f7ff",
                    border: "1px solid #dbeafe",
                    borderLeft: "3px solid #6d28d9",
                  }}
                >
                  <div className="flex items-center justify-between mb-2.5 gap-2">
                    <div className="flex items-center gap-1.5">
                      <CornerUpLeft size={11} style={{ color: "#6d28d9" }} />
                      <span className="text-[11px] font-semibold" style={{ color: "#6d28d9" }}>
                        {sentByLabel}
                      </span>
                      {isAuto && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: "#ede9fe", color: "#6d28d9" }}>
                          AUTO
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {formattedDate} · {formattedTime}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {se.body}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Mark as row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Mark as:</span>
          <button
            onClick={() => onMarkInterested(reply.id, reply.interested === true ? null : true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: reply.interested === true ? "#d1fae5" : "#f8faf8",
              color: reply.interested === true ? "#065f46" : "#6b7280",
              border: `1px solid ${reply.interested === true ? "#6ee7b7" : "#e5e7eb"}`,
              fontWeight: reply.interested === true ? 600 : 400,
            }}
          >
            <CheckCircle size={12} /> Interested
          </button>
          <button
            onClick={() => onMarkInterested(reply.id, reply.interested === false ? null : false)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: reply.interested === false ? "#fee2e2" : "#f8f8f8",
              color: reply.interested === false ? "#991b1b" : "#6b7280",
              border: `1px solid ${reply.interested === false ? "#fca5a5" : "#e5e7eb"}`,
              fontWeight: reply.interested === false ? 600 : 400,
            }}
          >
            <XCircle size={12} /> Not interested
          </button>

          <button
            onClick={() => setShowCallModal(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: meetingBooked ? "#d1fae5" : "#f8f7f5",
              color: meetingBooked ? "#065f46" : "#6b7280",
              border: `1px solid ${meetingBooked ? "#6ee7b7" : "#e5e7eb"}`,
              fontWeight: meetingBooked ? 600 : 400,
            }}
          >
            <CalendarCheck size={12} />
            {meetingBooked ? `Call booked${calls.length > 1 ? ` (${calls.length})` : ""}` : "Book a call"}
          </button>

          {/* Mark as unread — only shown if reply has been read and not yet replied */}
          {reply.status === "read" && onMarkUnread && (
            <button
              onClick={() => onMarkUnread(reply.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ml-auto"
              style={{
                background: "#f8f7f5",
                color: "#6b7280",
                border: "1px solid #e5e7eb",
              }}
            >
              <MailOpen size={12} /> Mark as unread
            </button>
          )}
        </div>
      </div>

      {/* Call booking modal */}
      {showCallModal && (
        <CallBookingModal
          replyId={reply.id}
          workspaceSlug={workspace.slug}
          leadName={reply.leadName}
          leadEmail={reply.leadEmail}
          existingCalls={calls}
          onClose={() => setShowCallModal(false)}
          onBooked={() => {
            setMeetingBooked(true);
            // Refresh call list
            fetch(`/api/calls?replyId=${reply.id}`)
              .then(r => r.json())
              .then(d => setCalls(d.calls ?? []))
              .catch(() => {});
          }}
        />
      )}

      {/* Composer */}
      <div className="shrink-0" style={{ background: "#ffffff", borderTop: "1px solid #ede9e3" }}>

        {showCalendly && (
          <CalendlySlotPicker
            leadName={reply.leadName}
            leadEmail={reply.leadEmail}
            onInsertReply={(text) => {
              setReplyText(text);
              textareaRef.current?.focus();
            }}
          />
        )}

        <div className="px-6 py-4 space-y-3">

          {analyzing && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
              style={{ background: "#faf5ff", border: "1px solid #ede9fe" }}>
              <Loader2 size={12} className="animate-spin" style={{ color: "#7c3aed" }} />
              <p className="text-xs" style={{ color: "#7c3aed" }}>
                Writing reply for {reply.leadName.split(" ")[0]}...
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">

            {/* Template picker — loads real templates from EmailBison */}
            <div ref={dropdownRef} className="relative">
              <button
                onClick={toggleTemplateOpen}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-colors"
                style={{
                  background: "#f8f7f5",
                  border: "1px solid #e5e7eb",
                  color: selectedTemplate ? "#111827" : "#9ca3af",
                }}
              >
                <LayoutTemplate size={12} />
                {selectedTemplate ? selectedTemplate.name : "Use a template"}
                <ChevronDown size={11} className="text-gray-400" />
              </button>

              {templateOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-64 rounded-xl overflow-hidden z-20"
                  style={{ background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
                  {templatesLoading ? (
                    <div className="flex items-center gap-2 px-4 py-3">
                      <Loader2 size={11} className="animate-spin text-gray-400" />
                      <span className="text-xs text-gray-400">Loading templates...</span>
                    </div>
                  ) : templates.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 py-3">No templates found</p>
                  ) : (
                    templates.map((t) => (
                      <button key={t.id} onClick={() => pickTemplate(t)}
                        className="w-full text-left px-4 py-2.5 text-xs transition-colors"
                        style={{ color: "#374151", borderBottom: "1px solid #f3f4f6" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f7f5")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                      >
                        {t.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Check availability */}
            <button
              onClick={() => setShowCalendly((p) => !p)}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-all"
              style={{
                background: showCalendly ? "#d1fae5" : "#f8f7f5",
                border: `1px solid ${showCalendly ? "#6ee7b7" : "#e5e7eb"}`,
                color: showCalendly ? "#065f46" : "#6b7280",
              }}
            >
              <Calendar size={12} />
              {showCalendly ? "Hide slots" : "Check availability"}
            </button>

            {/* Write reply with AI */}
            <button
              onClick={runAI}
              disabled={analyzing}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-all"
              style={{
                background: analyzing ? "#faf5ff" : "#7c3aed",
                border: "1px solid #7c3aed",
                color: analyzing ? "#7c3aed" : "#ffffff",
                fontWeight: 500,
                cursor: analyzing ? "not-allowed" : "pointer",
              }}
            >
              {analyzing
                ? <><Loader2 size={12} className="animate-spin" /> Writing...</>
                : <><Sparkles size={12} /> Write reply with AI</>
              }
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply, use a template, or click 'Write reply with AI'..."
            rows={4}
            className="w-full text-sm px-3.5 py-3 rounded-xl resize-none focus:outline-none leading-relaxed"
            style={{
              background: "#f8f7f5",
              border: "1px solid #e5e7eb",
              color: "#111827",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#93c5fd")}
            onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
          />

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">
              Via <span className="text-gray-500">{reply.senderEmail}</span>
            </p>
            <button
              onClick={handleSend}
              disabled={!replyText.trim() || sending || sent}
              className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all"
              style={{
                background: sent ? "#059669" : replyText.trim() && !sending ? "#1a56db" : "#e5e7eb",
                color: replyText.trim() || sent ? "#ffffff" : "#9ca3af",
                cursor: replyText.trim() && !sending && !sent ? "pointer" : "not-allowed",
              }}
            >
              {sent ? <><Check size={13} /> Sent</>
                : sending ? <><div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Sending</>
                : <><Send size={13} /> Send reply</>}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}