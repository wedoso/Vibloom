import type { CSSProperties, ReactElement } from "react";
import "./render-groups.css";
/** Retain every row for native find, tab order, selection and drag/drop. Batch
 * containment to avoid one paint boundary per song. Focused/hovered groups
 * allow tooltips to extend outside their bounds. */
export default function RenderGroups({ children, rowHeight, table = false }: { children: ReactElement[]; rowHeight: number; table?: boolean }) {
  if (children.length < 128) return <>{children}</>;
  const groups = [];
  for (let first = 0; first < children.length; first += 32) {
    const rows = children.slice(first, first + 32);
    groups.push(<div className="library-render-group" role={table ? "rowgroup" : undefined} key={rows[0].key} style={{ containIntrinsicBlockSize: `auto ${rows.length * rowHeight}px`, "--render-count": rows.length } as CSSProperties}>{rows}</div>);
  }
  return <>{groups}</>;
}
