"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

// KPI Tracker — replaces the weekly performance Google Sheet.
// Shows weekly + MTD breakdown for a single month, per workspace or all.

interface DBWorkspace {
  slug: string;
  name: string;
}

interface WeekKPIs {
  label: string;          // "Week 1" .. "MTD"
  start: string;
  end: string;
  totals: { sent: number; replies: number; interested: number; meetings: number };
  efficiency: {
    reply_rate: number;
    interested_rate: number;
    conv_rate: number;
    emails_per_lead: number;
    emails_per_meeting: number;
  };
}

interface KPIPayload {
  workspaces: DBWorkspace[];
  workspace: string;
  year: number;
  month: number;
  buckets: WeekKPIs[];
  successLabel?: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0,00%";
  return `${(n * 100).toFixed(2).replace(".", ",")}%`;
}
function fmtRatio(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Math.round(n).toLocaleString();
}
function fmtInt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString();
}

// Color band based on threshold. tone "good" = green, "bad" = red, "ok" = neutral.
function rateCellTone(rate: number, good: number, ok: number): "good" | "ok" | "bad" | "empty" {
  if (!Number.isFinite(rate) || rate <= 0) return "empty";
  if (rate >= good) return "good";
  if (rate >= ok)   return "ok";
  return "bad";
}

// For ratio cells (lower is better)
function ratioCellTone(r: number, good: number, ok: number): "good" | "ok" | "bad" | "empty" {
  if (!Number.isFinite(r) || r <= 0) return "empty";
  if (r <= good) return "good";
  if (r <= ok)   return "ok";
  return "bad";
}

const TONE_BG: Record<string, string> = {
  good:  "bg-emerald-100 text-emerald-900",
  ok:    "bg-amber-50    text-amber-900",
  bad:   "bg-rose-100    text-rose-900",
  empty: "bg-slate-50    text-slate-400",
};

export function KPITracker() {
  const [data, setData] = useState<KPIPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [workspace, setWorkspace] = useState<string>("all");
  const [year,  setYear]  = useState<number>(now.getUTCFullYear());
  const [month, setMonth] = useState<number>(now.getUTCMonth() + 1);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/kpi-tracker?workspace=${workspace}&year=${year}&month=${month}`,
        { signal }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to load KPI tracker");
      }
      setData(await res.json());
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workspace, year, month]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else { setMonth(month - 1); }
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else { setMonth(month + 1); }
  }

  const buckets = data?.buckets ?? [];
  // We display all weeks always, plus MTD at the end. Some may be empty (e.g. Week 5 in February).
  const weekBuckets = buckets.filter(b => b.label !== "MTD");
  const mtdBucket   = buckets.find(b => b.label === "MTD");

  function renderTotalCell(key: string, value: number) {
    return (
      <td key={key} className={`px-3 py-2 text-right font-medium ${value > 0 ? "text-slate-900" : "text-slate-400"}`}>
        {fmtInt(value)}
      </td>
    );
  }

  function renderRateCell(key: string, rate: number, good: number, ok: number) {
    const tone = rateCellTone(rate, good, ok);
    return (
      <td key={key} className={`px-3 py-2 text-right text-sm font-medium ${TONE_BG[tone]}`}>
        {fmtPct(rate)}
      </td>
    );
  }

  function renderRatioCell(key: string, r: number, good: number, ok: number) {
    const tone = ratioCellTone(r, good, ok);
    return (
      <td key={key} className={`px-3 py-2 text-right text-sm font-medium ${TONE_BG[tone]}`}>
        {fmtRatio(r)}
      </td>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="max-w-[1600px] mx-auto p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">KPI Tracker</h1>
            <p className="text-sm text-slate-500 mt-1">
              Weekly + month-to-date performance, Mon-Sun weeks clipped to the calendar month
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Workspace dropdown */}
            <div className="relative">
              <select
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="appearance-none rounded-xl border border-slate-300 bg-white pl-4 pr-9 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All workspaces</option>
                {(data?.workspaces ?? []).map(w => (
                  <option key={w.slug} value={w.slug}>{w.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {/* Month picker */}
            <div className="flex items-center rounded-xl border border-slate-300 bg-white overflow-hidden">
              <button onClick={prevMonth} className="px-2 py-2.5 text-slate-500 hover:bg-slate-50" title="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-2.5 text-sm font-medium text-slate-700 min-w-[140px] text-center">
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <button onClick={nextMonth} className="px-2 py-2.5 text-slate-500 hover:bg-slate-50" title="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
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

        {/* Weekly breakdown table */}
        {data && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 sticky left-0 bg-slate-50 z-10">
                    Metric
                  </th>
                  {weekBuckets.map(b => (
                    <th key={b.label} className="px-3 py-3 text-right font-semibold text-slate-600 min-w-[110px]">
                      <div>{b.label}</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">{b.start.slice(-2)} – {b.end.slice(-2)}</div>
                    </th>
                  ))}
                  {mtdBucket && (
                    <th className="px-3 py-3 text-right font-semibold text-slate-700 bg-amber-50 min-w-[110px]">
                      Month to date
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Total numbers section */}
                <tr className="bg-emerald-50/50">
                  <td colSpan={weekBuckets.length + 2} className="px-4 py-2 text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                    Total Numbers
                  </td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Emails Sent</td>
                  {weekBuckets.map(b => renderTotalCell(b.label, b.totals.sent))}
                  {mtdBucket && <td className="px-3 py-2 text-right font-semibold text-slate-900 bg-amber-50/50">{fmtInt(mtdBucket.totals.sent)}</td>}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Total Replies</td>
                  {weekBuckets.map(b => renderTotalCell(b.label, b.totals.replies))}
                  {mtdBucket && <td className="px-3 py-2 text-right font-semibold text-slate-900 bg-amber-50/50">{fmtInt(mtdBucket.totals.replies)}</td>}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Positive Replies</td>
                  {weekBuckets.map(b => renderTotalCell(b.label, b.totals.interested))}
                  {mtdBucket && <td className="px-3 py-2 text-right font-semibold text-slate-900 bg-amber-50/50">{fmtInt(mtdBucket.totals.interested)}</td>}
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="px-4 py-2 font-semibold text-slate-800 sticky left-0 bg-white">{data.successLabel || "Conversions"}</td>
                  {weekBuckets.map(b => (
                    <td key={b.label} className={`px-3 py-2 text-right font-semibold ${b.totals.meetings > 0 ? "text-slate-900" : "text-slate-400"}`}>
                      {fmtInt(b.totals.meetings)}
                    </td>
                  ))}
                  {mtdBucket && <td className="px-3 py-2 text-right font-semibold text-slate-900 bg-amber-50/50">{fmtInt(mtdBucket.totals.meetings)}</td>}
                </tr>

                {/* Efficiency section */}
                <tr className="bg-emerald-50/50">
                  <td colSpan={weekBuckets.length + 2} className="px-4 py-2 text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                    Efficiency Numbers
                  </td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Reply Rate %</td>
                  {/* GOOD ≥ 1%, OK 0.5-1%, BAD < 0.5% */}
                  {weekBuckets.map(b => renderRateCell(b.label, b.efficiency.reply_rate, 0.01, 0.005))}
                  {mtdBucket && renderRateCell("mtd", mtdBucket.efficiency.reply_rate, 0.01, 0.005)}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Positive Reply %</td>
                  {/* GOOD ≥ 20%, OK 12.5-20%, BAD < 12.5% */}
                  {weekBuckets.map(b => renderRateCell(b.label, b.efficiency.interested_rate, 0.20, 0.125))}
                  {mtdBucket && renderRateCell("mtd", mtdBucket.efficiency.interested_rate, 0.20, 0.125)}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white">Conversion Rate %</td>
                  {/* GOOD ≥ 45%, OK 30-45%, BAD < 30% */}
                  {weekBuckets.map(b => renderRateCell(b.label, b.efficiency.conv_rate, 0.45, 0.30))}
                  {mtdBucket && renderRateCell("mtd", mtdBucket.efficiency.conv_rate, 0.45, 0.30)}
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 font-semibold text-slate-800 sticky left-0 bg-white">Email : Lead Ratio</td>
                  {/* Derived from rate thresholds, GOOD ≤ 500 (1% × 20%), OK ≤ 1600 (0.5% × 12.5%), BAD above */}
                  {weekBuckets.map(b => renderRatioCell(b.label, b.efficiency.emails_per_lead, 500, 1600))}
                  {mtdBucket && renderRatioCell("mtd", mtdBucket.efficiency.emails_per_lead, 500, 1600)}
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold text-slate-800 sticky left-0 bg-white">Email : {data.successLabel ? (data.successLabel.split(" ")[0]) : "Conversion"} Ratio</td>
                  {/* Derived, GOOD ≤ 1111 (1% × 20% × 45%), OK ≤ 5333 (0.5% × 12.5% × 30%), BAD above */}
                  {weekBuckets.map(b => renderRatioCell(b.label, b.efficiency.emails_per_meeting, 1111, 5333))}
                  {mtdBucket && renderRatioCell("mtd", mtdBucket.efficiency.emails_per_meeting, 1111, 5333)}
                </tr>
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center justify-between flex-wrap gap-2">
              <div>
                Color coding,
                <span className="inline-block ml-2 mr-2 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">good</span>
                <span className="inline-block mr-2 px-2 py-0.5 rounded bg-amber-50 text-amber-900">ok</span>
                <span className="inline-block mr-2 px-2 py-0.5 rounded bg-rose-100 text-rose-900">needs work</span>
                <span className="inline-block px-2 py-0.5 rounded bg-slate-50 text-slate-400">no data</span>
              </div>
              <div>
                {workspace === "all"
                  ? "Conversions = meetings (Airtable, real) + 40% of positive replies for proxy workspaces (911, ACT, Statera, Hahnbeck). 40% is our historical average where downstream tracking is not visible."
                  : `${data.successLabel || "Conversions"} sourced from ${data.successLabel?.toLowerCase().includes("meeting") ? "Airtable" : "40% of positive replies (historical average)"}.`}
              </div>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading KPI tracker…
          </div>
        )}
      </div>
    </div>
  );
}
