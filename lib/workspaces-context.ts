"use client";

import { createContext, useContext } from "react";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  color: string;
  initials: string;
  instanceUrl: string;
}

const PALETTE = [
  "#185FA5", "#0F6E56", "#7C3AED", "#B45309", "#DC2626",
  "#533AB7", "#0369A1", "#0F6E56", "#185FA5", "#9D174D",
  "#065F46", "#1E3A5F", "#6D28D9", "#92400E", "#0F766E",
  "#374151", "#7C2D12", "#1D4ED8", "#065F46", "#78350F",
];

export function buildWorkspaceFromRow(row: any, index: number): Workspace {
  const words = row.name.split(/[\s\-]+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : row.name.slice(0, 2).toUpperCase();
  return {
    id:          String(row.id),
    slug:        row.slug,
    name:        row.name,
    instanceUrl: row.instanceUrl ?? row.email_bison_instance_url ?? "",
    color:       PALETTE[index % PALETTE.length],
    initials,
  };
}

export const FALLBACK_WS: Workspace = {
  id: "unknown", slug: "unknown", name: "Unknown",
  color: "#6b7280", initials: "??", instanceUrl: "",
};

export const WorkspacesContext = createContext<Workspace[]>([]);

export function useWorkspaces() {
  return useContext(WorkspacesContext);
}

/** Lookup by DB id or slug. Returns FALLBACK_WS if not found. */
export function findWorkspace(workspaces: Workspace[], slugOrId: string): Workspace {
  return workspaces.find(w => w.id === slugOrId || w.slug === slugOrId) ?? FALLBACK_WS;
}