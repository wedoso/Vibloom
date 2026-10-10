import { createContext, useContext, useId, type ReactNode } from "react";
import { ArrowLeftRight, AudioLines, Check, CircleAlert, Clock3, FileText, GripVertical, LoaderCircle, MicVocal, MoreHorizontal } from "lucide-react";

const icons = { ArrowLeftRight, AudioLines, Check, CircleAlert, Clock3, FileText, GripVertical, LoaderCircle, MicVocal, MoreHorizontal };
const Scope = createContext<string | null>(null);
/** Share the original Lucide geometry in large lists without removing rows,
 * searchable text, keyboard targets or screen-reader labels from the DOM. */
export function LibraryIcons({ children, shared }: { children: ReactNode; shared: boolean }) {
  const id = useId();
  return <Scope.Provider value={shared ? id : null}>
    {shared && <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }}>
      <defs>{Object.entries(icons).map(([name, Icon]) => <symbol id={`${id}-${name}`} key={name} viewBox="0 0 24 24"><Icon size={24} /></symbol>)}</defs>
    </svg>}
    {children}
  </Scope.Provider>;
}

export function LibraryIcon({ name, size, className = "", hidden }: { name: keyof typeof icons; size: number; className?: string; hidden?: boolean }) {
  const scope = useContext(Scope), Icon = icons[name];
  if (!scope) return <Icon size={size} className={className} aria-hidden={hidden} />;
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide ${className}`} aria-hidden={hidden}>
    <use href={`#${scope}-${name}`} />
  </svg>;
}
