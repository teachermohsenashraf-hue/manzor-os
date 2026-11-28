import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="action-link">{children}<ArrowLeft size={16} aria-hidden="true" /></Link>;
}

export function StatusRow({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link href={href} className={`status-row ${value > 0 ? 'has-items' : 'is-zero'}`} aria-label={`${label}: ${value}، عرض التفاصيل`}>
    <span>{label}</span><strong dir="ltr">{value.toLocaleString('en-US')}</strong><ArrowLeft size={15} aria-hidden="true" />
  </Link>;
}

export function MetricCard({ label, value, note, quiet = false, attention = false, tour }: {
  label: string; value: ReactNode; note?: ReactNode; quiet?: boolean; attention?: boolean; tour?: string;
}) {
  return <section className={`card stat${quiet ? ' is-zero' : ''}${attention ? ' needs-attention' : ''}`} data-tour={tour}>
    <small>{label}</small><strong className="metric-value">{value}</strong>{note && <small>{note}</small>}
  </section>;
}
