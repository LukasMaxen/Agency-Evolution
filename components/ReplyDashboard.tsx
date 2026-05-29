"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Loader2, ChevronDown } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "all";

interface DBWorkspace {
  id: string;
  slug: string;
  name: string;
  color: string;
  initials: string;
  instanceUrl: string;
}

interface DashboardPayload {
  workspaces: DBWorkspace[];
  workspace: string;
  range: RangeKey;
  totals: {
    sent: number;
    contacted: number;
    replies: number;
    interested: number;
    bounced: number;
    meetings: number;
  };
  rates: {
    reply_rate: number;
    interested_rate: number;
    bounce_rate: number;
    conv_rate: number;
    emails_per_lead: number;
    emails_per_meeting: number;
  };
  series: Array<{ date: string; sent: number; replies: number; interested: number; bounced: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0%";
  const pct = n * 100;
  return pct >= 10 ? `${pct.toFixed(1)}%` : `${pct.toFixed(2)}%`;
}

function fmtRatio(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${Math.round(n).toLocaleString()}:1`;
}

function fmtInt(n: number): string {
  return (n ?? 0).toLocaleString();
}

function rateTone(rate: number, good: number, ok: number): "green" | "yellow" | "red" | "neutral" {
  if (!Number.isFinite(rate) || rate <= 0) return "neutral";
  if (rate >= good) return "green";
  if (rate >= ok)   return "yellow";
  return "red";
}

const TONE_BG: Record<string, string> = {
  green:   "bg-emerald-50 text-emerald-700",
  yellow:  "bg-amber-50  text-amber-700",
  red:     "bg-rose-50   text-rose-700",
  neutral: "bg-slate-100 text-slate-600",
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  rate?: { value: string; tone: "green" | "yellow" | "red" | "neutral"; label?: string };
  sub?: string;
}

function KpiCard({ label, value, rate, sub }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        {rate && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${TONE_BG[rate.tone]}`}>
            {rate.value}{rate.label ? ` ${rate.label}` : ""}
          </span>
        )}
      </div>
      <div className="text-3xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// ─── Workspace selector ───────────────────────────────────────────────────────

function WorkspaceSelect({
  workspaces, value, onChange,
}: { workspaces: DBWorkspace[]; value: string; onChange: (v: string) => void }) {
  const selected = value === "all"
    ? { name: "All workspaces", initials: "AW", color: "#475569" }
    : workspaces.find(w => w.slug === value) ?? { name: value, initials: "??", color: "#475569" };

  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-slate-300 bg-white pl-12 pr-9 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All workspaces</option>
        {workspaces.map(w => (
          <option key={w.slug} value={w.slug}>{w.name}</option>
        ))}
      </select>
      <div
        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-semibold pointer-events-none"
        style={{ backgroundColor: selected.color }}
      >
        {selected.initials}
      </div>
      <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ─── Range pills ─────────────────────────────────────────────────────────────

function RangePills({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  const opts: RangeKey[] = ["today", "yesterday", "7d", "30d", "all"];
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1">
      {opts.map(k => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            value === k
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {RANGE_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ReplyDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [workspace, setWorkspace] = useState<string>("all");
  const [range, setRange] = useState<RangeKey>("7d");

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?workspace=${workspace}&range=${range}`, { signal });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to load dashboard");
      }
      const payload = await res.json();
      setData(payload);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workspace, range]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  const seriesForChart = useMemo(() => {
    if (!data?.series) return [];
    return data.series.map(p => ({
      ...p,
      // Recharts axis labels look better with short month-day labels
      label: p.date.slice(5).replace("-", "/"),
    }));
  }, [data?.series]);

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="max-w-[1600px] mx-auto p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Main Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">
              {workspace === "all"
                ? "Full overview across every active workspace"
                : `Full overview of ${data?.workspaces.find(w => w.slug === workspace)?.name ?? workspace}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <WorkspaceSelect workspaces={data?.workspaces ?? []} value={workspace} onChange={setWorkspace} />
            <RangePills value={range} onChange={setRange} />
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="p-2.5 rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              title="Refresh"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
            {error}
          </div>
        )}

        {/* KPI Grid */}
        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KpiCard
                label="Emails sent"
                value={fmtInt(data.totals.sent)}
              />
              <KpiCard
                label="Total people contacted"
                value={fmtInt(data.totals.contacted)}
              />
              <KpiCard
                label="Replies"
                value={fmtInt(data.totals.replies)}
                rate={{ value: fmtPct(data.rates.reply_rate), tone: rateTone(data.rates.reply_rate, 0.03, 0.01) }}
              />
              <KpiCard
                label="Bounced"
                value={fmtInt(data.totals.bounced)}
                rate={{ value: fmtPct(data.rates.bounce_rate), tone: data.rates.bounce_rate >= 0.05 ? "red" : data.rates.bounce_rate >= 0.02 ? "yellow" : "green" }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KpiCard
                label="Positive replies"
                value={fmtInt(data.totals.interested)}
                rate={{ value: fmtPct(data.rates.interested_rate), tone: rateTone(data.rates.interested_rate, 0.3, 0.15) }}
                sub="of total replies"
              />
              <KpiCard
                label="Meetings booked"
                value={fmtInt(data.totals.meetings)}
                rate={{ value: fmtPct(data.rates.conv_rate), tone: rateTone(data.rates.conv_rate, 0.2, 0.1) }}
                sub="conversion rate"
              />
              <KpiCard
                label="Emails per lead"
                value={fmtRatio(data.rates.emails_per_lead)}
                sub="sent ÷ positive replies"
              />
              <KpiCard
                label="Emails per meeting"
                value={fmtRatio(data.rates.emails_per_meeting)}
                sub="sent ÷ meetings"
              />
            </div>

            {/* Chart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">Daily trend</h2>
                <span className="text-xs text-slate-400">{seriesForChart.length} day{seriesForChart.length === 1 ? "" : "s"}</span>
              </div>
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={seriesForChart} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradReplies" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradInterested" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradBounced" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} stroke="#cbd5e1" />
                    <YAxis tick={{ fontSize: 12, fill: "#64748b" }} stroke="#cbd5e1" />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                      labelStyle={{ color: "#0f172a", fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                    <Area type="monotone" dataKey="sent"       name="Sent"             stroke="#3b82f6" fill="url(#gradSent)"       strokeWidth={2} />
                    <Area type="monotone" dataKey="replies"    name="Replies"          stroke="#8b5cf6" fill="url(#gradReplies)"    strokeWidth={2} />
                    <Area type="monotone" dataKey="interested" name="Positive replies" stroke="#10b981" fill="url(#gradInterested)" strokeWidth={2} />
                    <Area type="monotone" dataKey="bounced"    name="Bounced"          stroke="#f43f5e" fill="url(#gradBounced)"    strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading dashboard…
          </div>
        )}
      </div>
    </div>
  );
}
