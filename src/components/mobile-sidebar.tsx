'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';

export function MobileSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <>
    <button type="button" ref={trigger} className="mobile-menu-trigger secondary" aria-label="فتح القائمة" aria-controls="workspace-sidebar" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21} /></button>
    {open && <button type="button" className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={close} />}
    <aside id="workspace-sidebar" className={open ? 'sidebar is-open' : 'sidebar'} role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-label="قائمة منظور"
      onClick={event => { if ((event.target as HTMLElement).closest('a[href]')) setOpen(false); }}
      onKeyDown={event => {
        if (!open || event.key !== 'Tab') return;
        const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary'));
        const visible = focusables.filter(item => item.getClientRects().length > 0);
        const current = visible.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && current === 0) { event.preventDefault(); visible.at(-1)?.focus(); }
        if (!event.shiftKey && current === visible.length - 1) { event.preventDefault(); visible[0]?.focus(); }
      }}>
      <button type="button" ref={closeButton} className="sidebar-close secondary" aria-label="إغلاق القائمة" onClick={close}><X size={20} /></button>
      {children}
    </aside>
  </>;
}
