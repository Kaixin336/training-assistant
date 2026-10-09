import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ChevronDown, ChevronLeft, ChevronRight, Settings as Gear } from "lucide-react";
import { storageGet, storageSet } from "./api";

/* Navigation: each tab keeps its own stack, so switching tabs never loses your place. */
export type Route = { screen: string; params?: Record<string, string>; scroll?: number };
export const NavContext = createContext<{ push: (route: Route) => void; pop: () => void; settings: () => void }>({ push: () => {}, pop: () => {}, settings: () => {} });
export const useNav = () => useContext(NavContext);

/** A screen with an iOS-style navigation bar; the large title collapses into the bar on scroll. Tab roots carry the 设置 gear. */
export function Screen({ title, large = true, back, right, kicker, composer = false, root = false, children }: {
  title: string; large?: boolean; back?: string; right?: ReactNode; kicker?: ReactNode; composer?: boolean; root?: boolean; children: ReactNode;
}) {
  const nav = useNav();
  const sentinel = useRef<HTMLDivElement>(null);
  const [solid, setSolid] = useState(!large);
  useEffect(() => {
    if (!large || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => setSolid(!entry.isIntersecting), { rootMargin: "-52px 0px 0px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [large]);
  return <div className={`screen${composer ? " with-composer" : ""}${root ? " root" : ""}`}>
    <header className={`navbar${solid ? " solid" : ""}${large ? "" : " always"}`}>
      <div className="navbar-left">{back && <button className="back" onClick={nav.pop}><ChevronLeft />{back}</button>}</div>
      <div className="navbar-title">{title}</div>
      <div className="navbar-right">{right}{root && !back && <button className="icon-btn" aria-label="设置" onClick={nav.settings}><Gear /></button>}</div>
    </header>
    {large && <>{kicker && <div className="kicker">{kicker}</div>}<h1 className="large-title">{title}</h1><div ref={sentinel} /></>}
    {children}
  </div>;
}

export function Section({ title, meta, action, children, className = "" }: { title?: ReactNode; meta?: ReactNode; action?: { label: string; onClick: () => void }; children: ReactNode; className?: string }) {
  return <section className={`section ${className}`}>
    {(title || meta || action) && <div className="section-head"><h2 className="section-title">{title}</h2>{action ? <button className="section-action" onClick={action.onClick}>{action.label}</button> : meta && <span className="section-meta">{meta}</span>}</div>}
    {children}
  </section>;
}

/** A section that folds to its title: `note` always shows, `summary` only while folded. Remembered per device. */
export function FoldSection({ id, title, meta, note, summary, defaultOpen = true, children }: { id: string; title: ReactNode; meta?: ReactNode; note?: ReactNode; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const key = `kai-fold-${id}`;
  const [open, setOpen] = useState(() => { const saved = storageGet(key); return saved === null ? defaultOpen : saved === "1"; });
  const toggle = () => { storageSet(key, open ? "0" : "1"); setOpen(!open); };
  return <section className={`section fold${open ? "" : " folded"}`}>
    <button className="section-head fold-head" onClick={toggle} aria-expanded={open}>
      <h2 className="section-title"><ChevronDown className="fold-chev" />{title}</h2>
      {meta && <span className="section-meta">{meta}</span>}
    </button>
    {note && <p className="fold-note">{note}</p>}
    {!open && summary && <p className="fold-summary">{summary}</p>}
    {open && children}
  </section>;
}

export function Row({ icon, title, sub, value, onClick, chevron, danger, children, as }: {
  icon?: ReactNode; title: ReactNode; sub?: ReactNode; value?: ReactNode; onClick?: () => void; chevron?: boolean; danger?: boolean; children?: ReactNode; as?: "label" | "div";
}) {
  const body = <>
    {icon && <span className="row-icon">{icon}</span>}
    <span className="row-main"><span className="row-title" style={{ display: "block" }}>{title}</span>{sub && <span className="row-sub" style={{ display: "block" }}>{sub}</span>}</span>
    {value !== undefined && <span className="row-value">{value}</span>}
    {children}
    {chevron && <ChevronRight className="row-chev" />}
  </>;
  const className = `row${danger ? " danger" : ""}`;
  if (onClick) return <button className={className} onClick={onClick}>{body}</button>;
  if (as === "label") return <label className={className}>{body}</label>;
  return <div className={className}>{body}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function Sheet({ open, onClose, title, left, right, tall, children }: { open: boolean; onClose: () => void; title: string; left?: ReactNode; right?: ReactNode; tall?: boolean; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className={`sheet${tall ? " tall" : ""}`} aria-describedby={undefined}>
        <div className="sheet-head">
          <div>{left ?? <Dialog.Close className="text-btn">取消</Dialog.Close>}</div>
          <Dialog.Title className="sheet-title">{title}</Dialog.Title>
          <div>{right}</div>
        </div>
        <div className="sheet-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/* Toasts: one at a time, with an optional action (usually 撤销). */
type ToastValue = { text: string; action?: { label: string; run: () => void }; id: number };
const ToastContext = createContext<(text: string, action?: ToastValue["action"]) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastValue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, action?: ToastValue["action"]) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ text, action, id });
    timer.current = setTimeout(() => setToast(current => current?.id === id ? null : current), action ? 6000 : 3000);
  }, []);
  return <ToastContext.Provider value={show}>
    {children}
    {toast && <div key={toast.id} className={`toast${toast.action ? "" : " plain"}`} role="status">
      <span>{toast.text}</span>
      {toast.action && <button onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}
    </div>}
  </ToastContext.Provider>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children && <div className="empty-text">{children}</div>}</div>;
}

export function Note({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <div className={`note ${tone}`}><span className="note-bar" /><div>{children}</div></div>;
}

/** Live clock for elapsed times; re-renders once a second only while mounted. */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [active]);
  return now;
}
