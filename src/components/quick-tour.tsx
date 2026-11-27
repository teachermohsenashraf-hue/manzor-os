'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CircleHelp } from 'lucide-react';
import type { Role } from '@/generated/prisma/client';

type Step = { path: string; target: string; title: string; text: string };
const start: Step = { path: '/dashboard', target: 'start-order', title: 'ابدأ بعميل وطلب', text: 'سجل العميل والطلب من مسار واحد، ثم تابع حالة الطلب' };
const form: Step = { path: '/orders', target: 'order-create', title: 'بيانات الطلب', text: 'أدخل البيانات الأساسية أولًا، وافتح التفاصيل الإضافية عند الحاجة' };
const list: Step = { path: '/orders', target: 'orders-list', title: 'تابع الخطوة التالية', text: 'كل طلب يعرض حالته وما يحتاجه بعد التسجيل' };
const projects: Step = { path: '/projects', target: 'project-list', title: 'تابع الأعمال', text: 'افتح العمل لمعرفة حالته والإجراء المطلوب من دورك' };
const roleSteps: Partial<Record<Role, Step[]>> = {
  OWNER: [start, form, list, { ...projects, text: 'راجع التكليفات والأعمال التي تحتاج اعتمادًا منك' }, { path: '/dashboard', target: 'owner-approvals', title: 'قرارات المالك', text: 'تظهر هنا الموافقات والتحصيلات المعلقة لمراجعتها' }],
  COMMUNICATION: [start, form, list, { ...projects, text: 'تابع أعمال فريقك، ثم سجل معاينة العميل وموافقته وتسليمه من صفحة العمل' }],
  EXECUTION: [
    { path: '/dashboard', target: 'assigned-work', title: 'ابدأ من أعمالك', text: 'تظهر هنا الأعمال المسندة إليك ومواعيدها' },
    { ...projects, text: 'افتح العمل لتقبل التكليف وتسجل التنفيذ وإرسال المعاينة للمالك' },
    { path: '/dashboard', target: 'executor-earnings', title: 'مستحقاتك', text: 'راجع المستحقات المصرح لك برؤيتها' },
  ],
};
type Focus = { top: number; left: number; width: number; height: number; tipTop: number; tipLeft: number };

export function QuickTour({ role }: { role: Role }) {
  const steps = roleSteps[role];
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const step = steps?.[index];

  useEffect(() => {
    if (open && step && pathname !== step.path) router.push(step.path);
  }, [open, pathname, router, step]);

  useEffect(() => {
    if (!open || !step || pathname !== step.path) return;
    let element: Element | null = null;
    let frame = 0;
    const findTarget = () => Array.from(document.querySelectorAll(`[data-tour="${step.target}"]`))
      .find(candidate => { const rect = candidate.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) ?? null;
    const measure = () => {
      element = findTarget();
      if (!element) { setFocus(null); return; }
      const rect = element.getBoundingClientRect();
      const top = Math.max(8, rect.top - 6);
      const bottom = Math.min(window.innerHeight - 8, rect.bottom + 6);
      const left = Math.max(8, rect.left - 6);
      const right = Math.min(window.innerWidth - 8, rect.right + 6);
      const tipWidth = Math.min(350, window.innerWidth - 24);
      const tipTop = bottom + 224 < window.innerHeight ? bottom + 12 : Math.max(12, top - 216);
      const tipLeft = Math.max(12, Math.min(window.innerWidth - tipWidth - 12, right - tipWidth));
      setFocus({ top, left, width: Math.max(20, right - left), height: Math.max(20, bottom - top), tipTop, tipLeft });
    };
    const locate = () => {
      element = findTarget();
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      frame = requestAnimationFrame(measure);
      nextButton.current?.focus({ preventScroll: true });
    };
    locate();
    const observer = new MutationObserver(() => { if (!element) locate(); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, pathname, step]);

  if (!steps?.length) return null;
  const close = () => { setOpen(false); setFocus(null); };
  const startTour = () => { setIndex(0); setFocus(null); setOpen(true); };
  const change = (offset: number) => { setFocus(null); setIndex(current => current + offset); };
  const spotStyle: CSSProperties | undefined = focus ? { top: focus.top, left: focus.left, width: focus.width, height: focus.height } : undefined;
  const tipStyle: CSSProperties | undefined = focus ? { top: focus.tipTop, left: focus.tipLeft } : undefined;

  return <>
    <button type="button" className="tour-help secondary" onClick={startTour} aria-label="ابدأ الجولة التعريفية"><CircleHelp size={17} />مساعدة</button>
    {open && step && <div className="tour-layer" onKeyDown={event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.tour-popover button'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && current === 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
        if (!event.shiftKey && current === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }}>
      <div className="tour-backdrop" aria-hidden="true" />
      {focus && <div className="tour-spotlight" style={spotStyle} aria-hidden="true" />}
      <section className="tour-popover" style={tipStyle} role="dialog" aria-modal="true" aria-label="الجولة التعريفية" data-tour-step={index + 1}>
        <small>الخطوة {index + 1} من {steps.length}</small>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        {!focus && <p className="muted">جاري فتح الصفحة المطلوبة</p>}
        <div className="tour-actions">
          <button type="button" className="secondary" onClick={close}>تخطي</button>
          {index > 0 && <button type="button" className="secondary" onClick={() => change(-1)}>السابق</button>}
          <button type="button" ref={nextButton} onClick={() => index === steps.length - 1 ? close() : change(1)}>{index === steps.length - 1 ? 'إنهاء' : 'التالي'}</button>
        </div>
      </section>
    </div>}
  </>;
}
