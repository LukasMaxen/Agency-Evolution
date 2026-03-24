"use client";

import { useState, useRef, useEffect } from "react";
import { Reply, TEMPLATES, WORKSPACES, AIAnalysis } from "@/lib/mock-data";
import { analyzeReply, INTENT_CONFIG } from "@/lib/ai-analysis";
import { AIBadge } from "@/components/AIBadge";
import { getInitials, timeAgo, applyTemplate, buildEmailBisonUrl } from "@/lib/utils";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import {
  ExternalLink, ChevronDown, LayoutTemplate,
  Send, CheckCircle, XCircle, Check, Sparkles, Loader2, RefreshCw,
} from "lucide-react";

interface Props {
  reply: Reply;
  aiAnalysis?: AIAnalysis;
  onMarkInterested: (id: string, value: boolean | null) => void;
  onReplySent: (id: string) => void;
  onAIAnalyzed?: (replyId: string, analysis: AIAnalysis) => void;
}

export function ReplyDetail({ reply, aiAnalysis: initialAI, onMarkInterested, onReplySent, onAIAnalyzed }: Props) {
  const [replyText, setReplyText] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof TEMPLATES)[0] | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | undefined>(initialAI);
  const [analyzing, setAnalyzing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const workspace = WORKSPACES.find((w) => w.id === reply.workspaceId)!;
  const emailBisonUrl = buildEmailBisonUrl(workspace.instanceUrl, reply.emailBisonId);

  // Reset when reply changes
  useEffect(() => {
    setReplyText("");
    setSelectedTemplate(null);
    setTemplateOpen(false);
    setSent(false);
    setAiAnalysis(initialAI);
  }, [reply.id, initialAI]);

  // Auto-apply AI suggestion when analysis arrives
  useEffect(() => {
    if (aiAnalysis && !replyText) {
      // Pre-select the template
      if (aiAnalysis.suggestedTemplateId) {
        const t = TEMPLATES.find((t) => t.id === aiAnalysis.suggestedTemplateId);
        if (t) setSelectedTemplate(t);
      }
      // Pre-fill the suggested reply
      if (aiAnalysis.suggestedReply) {
        setReplyText(aiAnalysis.suggestedReply);
      }
    }
  }, [aiAnalysis]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const analysis = await analyzeReply(
        reply.leadName, reply.leadEmail, reply.campaign, reply.message
      );
      setAiAnalysis(analysis);
      onAIAnalyzed?.(reply.id, analysis);
    } catch (err) {
      console.error("AI error:", err);
    } finally {
      setAnalyzing(false);
    }
  }

  function pickTemplate(t: (typeof TEMPLATES)[0]) {
    setSelectedTemplate(t);
    setReplyText(applyTemplate(t.body, reply.leadName));
    setTemplateOpen(false);
    textareaRef.current?.focus();
  }

  async function handleSend() {
    if (!replyText.trim() || sending || sent) return;
    setSending(true);
    await new Promise((r) => setTimeout(r, 800));
    setSending(false);
    setSent(true);
    onReplySent(reply.id);
    setTimeout(() => setSent(false), 3000);
  }

  const intentCfg = aiAnalysis ? INTENT_CONFIG[aiAnalysis.intent] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f8f7f5" }}>

      {/* AI analysis banner — shown when analyzed */}
      {aiAnalysis && (
        <div
          className="px-6 py-3 flex items-center justify-between gap-4 shrink-0"
          style={{
            background: intentCfg!.bg,
            borderBottom: `1px solid ${intentCfg!.border}`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <AIBadge intent={aiAnalysis.intent} size="md" />
            <span className="text-xs truncate" style={{ color: intentCfg!.color }}>
              {aiAnalysis.summary}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {aiAnalysis.suggestedTemplateId && (
              <span className="text-[11px]" style={{ color: intentCfg!.color }}>
                Suggested:{" "}
                <span className="font-semibold">
                  {TEMPLATES.find((t) => t.id === aiAnalysis.suggestedTemplateId)?.name}
                </span>
              </span>
            )}
            <button
              onClick={handleAnalyze}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md"
              style={{ background: "white", color: intentCfg!.color, border: `1px solid ${intentCfg!.border}` }}
            >
              <RefreshCw size={9} />
              Re-analyze
            </button>
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
              <span className="text-xs font-medium" style={{ color: workspace.color }}>{workspace.name}</span>
            </div>

            {/* AI analyze button */}
            {!aiAnalysis && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors"
                style={{
                  background: "#faf5ff", color: analyzing ? "#a78bfa" : "#7c3aed",
                  border: "1px solid #ddd6fe",
                  cursor: analyzing ? "not-allowed" : "pointer",
                }}
              >
                {analyzing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {analyzing ? "Analyzing..." : "AI analyze"}
              </button>
            )}

            <a
              href={emailBisonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors"
              style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "#ffffff" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#1a56db"; (e.currentTarget as HTMLAnchorElement).style.color = "#1a56db"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e5e7eb"; (e.currentTarget as HTMLAnchorElement).style.color = "#6b7280"; }}
            >
              <ExternalLink size={11} />
              View in EmailBison
            </a>
          </div>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {[reply.campaign, `Via ${reply.senderEmail}`, timeAgo(reply.receivedAt)].map((t) => (
            <span key={t} className="text-[11px] px-2 py-0.5 rounded-md"
              style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Message */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{reply.subject}</p>

        <div className="rounded-xl p-4"
          style={{ background: "#ffffff", border: "1px solid #ede9e3", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-xs font-semibold text-gray-700">{reply.leadName}</span>
            <span className="text-[11px] text-gray-400">{timeAgo(reply.receivedAt)}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{reply.message}</p>
        </div>

        {/* Mark interested */}
        <div className="flex items-center gap-2">
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
            <CheckCircle size={12} />Interested
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
            <XCircle size={12} />Not interested
          </button>
        </div>
      </div>

      {/* Composer */}
      <div className="px-6 py-4 shrink-0 space-y-3"
        style={{ background: "#ffffff", borderTop: "1px solid #ede9e3" }}>

        {/* AI draft label */}
        {aiAnalysis?.suggestedReply && replyText === aiAnalysis.suggestedReply && (
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#7c3aed" }}>
            <Sparkles size={11} />
            AI-drafted reply — review and edit before sending
          </div>
        )}

        {/* Template picker */}
        <div ref={dropdownRef} className="relative w-fit">
          <button
            onClick={() => setTemplateOpen((p) => !p)}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-colors"
            style={{
              background: "#f8f7f5", border: "1px solid #e5e7eb",
              color: selectedTemplate ? "#111827" : "#9ca3af",
            }}
          >
            <LayoutTemplate size={12} />
            {selectedTemplate ? selectedTemplate.name : "Use a template"}
            <ChevronDown size={11} className="text-gray-400" />
          </button>

          {templateOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-60 rounded-xl overflow-hidden z-20"
              style={{ background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => pickTemplate(t)}
                  className="w-full text-left px-4 py-2.5 text-xs transition-colors flex items-center justify-between"
                  style={{ color: "#374151", borderBottom: "1px solid #f3f4f6" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f7f5")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                >
                  {t.name}
                  {aiAnalysis?.suggestedTemplateId === t.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "#faf5ff", color: "#7c3aed" }}>AI pick</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder={analyzing ? "AI is drafting your reply..." : "Write your reply or use a template..."}
          rows={5}
          className="w-full text-sm px-3.5 py-3 rounded-xl resize-none focus:outline-none leading-relaxed transition-colors"
          style={{
            background: analyzing ? "#faf5ff" : "#f8f7f5",
            border: `1px solid ${analyzing ? "#ddd6fe" : "#e5e7eb"}`,
            color: "#111827",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#93c5fd")}
          onBlur={(e) => (e.target.style.borderColor = analyzing ? "#ddd6fe" : "#e5e7eb")}
        />

        {/* Send row */}
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
            {sent ? <><Check size={13} />Sent</>
              : sending ? <><div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />Sending</>
              : <><Send size={13} />Send reply</>}
          </button>
        </div>
      </div>
    </div>
  );
}
