"use client";

import { Reply, WORKSPACES } from "@/lib/mock-data";
import { getInitials, timeAgo } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { Search } from "lucide-react";

interface Props {
  replies: Reply[];
  selectedId: string | null;
  search: string;
  filterStatus: string;
  filterWorkspace: string;
  onSelect: (reply: Reply) => void;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onWorkspaceChange: (v: string) => void;
}

export function ReplyList({
  replies, selectedId, search, filterStatus, filterWorkspace,
  onSelect, onSearchChange, onStatusChange, onWorkspaceChange,
}: Props) {
  const newCount = replies.filter((r) => r.status === "new").length;

  const filtered = replies.filter((r) => {
    if (filterWorkspace !== "all" && r.workspaceId !== filterWorkspace) return false;
    if (filterStatus === "new" && r.status !== "new") return false;
    if (filterStatus === "interested" && r.interested !== true) return false;
    if (filterStatus === "not_interested" && r.interested !== false) return false;
    if (filterStatus === "replied" && r.status !== "replied") return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !r.leadName.toLowerCase().includes(q) &&
        !r.leadEmail.toLowerCase().includes(q) &&
        !r.campaign.toLowerCase().includes(q) &&
        !r.message.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const STATUS_FILTERS = [
    { value: "all", label: "All" },
    { value: "new", label: "New" },
    { value: "interested", label: "Interested" },
    { value: "not_interested", label: "Not interested" },
    { value: "replied", label: "Replied" },
  ];

  return (
    <div
      className="w-72 shrink-0 flex flex-col h-full"
      style={{ background: "#ffffff", borderRight: "1px solid #ede9e3" }}
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0" style={{ borderBottom: "1px solid #ede9e3" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Inbox</h2>
          {newCount > 0 && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "#eff6ff", color: "#1a56db" }}
            >
              {newCount} new
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full text-xs pl-7 pr-3 py-2 rounded-lg focus:outline-none transition-colors"
            style={{
              background: "#f8f7f5",
              border: "1px solid #e5e7eb",
              color: "#111827",
            }}
          />
        </div>

        {/* Status filters */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onStatusChange(value)}
              className="text-[11px] px-2 py-1 rounded-lg transition-colors"
              style={{
                background: filterStatus === value ? "#1a56db" : "#f1f5f9",
                color: filterStatus === value ? "#ffffff" : "#6b7280",
                fontWeight: filterStatus === value ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Workspace filter */}
      <div className="px-4 py-2 shrink-0" style={{ borderBottom: "1px solid #ede9e3" }}>
        <select
          value={filterWorkspace}
          onChange={(e) => onWorkspaceChange(e.target.value)}
          className="w-full text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none"
          style={{
            background: "#f8f7f5",
            border: "1px solid #e5e7eb",
            color: "#374151",
          }}
        >
          <option value="all">All workspaces</option>
          {WORKSPACES.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-xs text-gray-400">No replies found</div>
        )}
        {filtered.map((r) => {
          const ws = WORKSPACES.find((w) => w.id === r.workspaceId)!;
          const isSelected = selectedId === r.id;
          const isNew = r.status === "new";

          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="w-full text-left px-4 py-3 transition-all"
              style={{
                background: isSelected ? "#eff6ff" : isNew ? "#fafaf9" : "#ffffff",
                borderBottom: "1px solid #f0ede8",
                borderLeft: isSelected ? "2px solid #1a56db" : "2px solid transparent",
              }}
            >
              <div className="flex items-start gap-2.5">
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5"
                  style={{
                    background: ws.color + "18",
                    color: ws.color,
                    border: `1.5px solid ${ws.color}30`,
                  }}
                >
                  {getInitials(r.leadName)}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Row 1: name + time */}
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isNew && (
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: "#1a56db" }}
                        />
                      )}
                      <span
                        className="text-xs truncate"
                        style={{
                          color: "#111827",
                          fontWeight: isNew ? 600 : 400,
                        }}
                      >
                        {r.leadName}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {timeAgo(r.receivedAt)}
                    </span>
                  </div>

                  {/* Row 2: workspace + badge */}
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-medium truncate" style={{ color: ws.color }}>
                      {ws.name}
                    </span>
                    <StatusBadge status={r.status} interested={r.interested} />
                  </div>

                  {/* Row 3: snippet */}
                  <p className="text-[11px] text-gray-400 truncate leading-relaxed">
                    {r.message}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
