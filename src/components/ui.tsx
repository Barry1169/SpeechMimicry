'use client';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, X, type LucideIcon } from 'lucide-react';

export function Modal({ title, description, close, busy = false, children, wide = false }: { title: string; description?: string; close: () => void; busy?: boolean; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    if (!current?.open) current?.showModal();
    return () => current?.close();
  }, []);
  return <dialog ref={dialog} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) close(); }}>
    <div className="dialog-inner">
      <header className="dialog-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-btn close-btn" aria-label="Close dialog" onClick={close} disabled={busy}><X size={19}/></button></header>
      {children}
    </div>
  </dialog>;
}

export function PageHeading({ tag, title, description, action }: { tag: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading">
    <div><div className="eyebrow"><span className="eyebrow-dot"/>{tag}</div><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="heading-action">{action}</div>}
  </header>;
}

export function Empty({ icon: Icon, title, message, action }: { icon: LucideIcon; title: string; message: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={23}/></span><h3>{title}</h3><p>{message}</p>{action}</div>;
}

export function PanelHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="text-link" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>;
}

export function Confirm({ title, message, action = 'Delete', close, confirm, busy }: { title: string; message: string; action?: string; close: () => void; confirm: () => void; busy?: boolean }) {
  return <Modal title={title} description={message} close={close} busy={busy}>
    <div className="dialog-actions"><button className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className="button danger" onClick={confirm} disabled={busy}>{busy ? 'Working…' : action}</button></div>
  </Modal>;
}

export function submitWith(action: () => void) { return (event: FormEvent) => { event.preventDefault(); action(); }; }
