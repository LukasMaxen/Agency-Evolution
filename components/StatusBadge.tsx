import { Reply } from "@/lib/mock-data";

interface Props {
  status: Reply["status"];
  interested: Reply["interested"];
}

export function StatusBadge({ status, interested }: Props) {
  if (interested === false)
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
        style={{ background: "#fee2e2", color: "#b91c1c" }}>
        Not interested
      </span>
    );
  if (interested === true)
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
        style={{ background: "#d1fae5", color: "#065f46" }}>
        Interested
      </span>
    );
  if (status === "new")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
        style={{ background: "#dbeafe", color: "#1d4ed8" }}>
        New
      </span>
    );
  if (status === "replied")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
        style={{ background: "#ede9fe", color: "#6d28d9" }}>
        Replied
      </span>
    );
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
      style={{ background: "#f1f5f9", color: "#64748b" }}>
      Read
    </span>
  );
}
