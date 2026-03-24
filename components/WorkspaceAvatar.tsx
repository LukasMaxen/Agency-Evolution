import { Workspace } from "@/lib/mock-data";

interface Props {
  workspace: Workspace;
  size?: number;
  className?: string;
}

export function WorkspaceAvatar({ workspace, size = 28 }: Props) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: workspace.color + "22",
        border: `1.5px solid ${workspace.color}55`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.36,
        fontWeight: 500,
        color: workspace.color,
        flexShrink: 0,
      }}
    >
      {workspace.initials}
    </div>
  );
}
