export const COMPACT_WIDTH = 900;
export interface WindowRect { x: number; y: number; width: number; height: number }
export interface WorkspaceSize { width: number; height: number }

export function availableRect(workspace: WorkspaceSize): WindowRect {
  const compact = workspace.width <= COMPACT_WIDTH;
  const margin = compact ? 6 : 12;
  const top = compact ? 6 : Math.min(48, workspace.height / 4);
  return { x: margin, y: top, width: Math.max(1, workspace.width - margin * 2), height: Math.max(1, workspace.height - top - margin) };
}

export function fitWindow(rect: WindowRect, workspace: WorkspaceSize): WindowRect {
  const available = availableRect(workspace);
  if (workspace.width <= COMPACT_WIDTH) return available;
  const width = Math.min(rect.width, available.width);
  const height = Math.min(rect.height, available.height);
  return {
    x: Math.max(available.x, Math.min(available.x + available.width - width, rect.x)),
    y: Math.max(available.y, Math.min(available.y + available.height - height, rect.y)),
    width, height,
  };
}
