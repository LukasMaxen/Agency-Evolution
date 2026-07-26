import { Inbox } from "lucide-react";

export function EmptyState() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-3"
      style={{ background: "#f8f7f5" }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: "#ffffff", border: "1px solid #ede9e3" }}
      >
        <Inbox size={16} className="text-gray-400" />
      </div>
      <p className="text-sm text-gray-400">Select a reply to respond</p>
    </div>
  );
}
