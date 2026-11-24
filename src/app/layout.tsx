import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const thmanyah = localFont({ src: [
  { path: './fonts/thmanyahserifdisplay-Regular.woff2', weight: '400', style: 'normal' },
  { path: './fonts/thmanyahserifdisplay-Bold.woff2', weight: '700', style: 'normal' }
], variable: '--font-thmanyah', display: 'swap', fallback: ['Tahoma', 'sans-serif'] });
const display = localFont({ src: './fonts/thmanyahserifdisplay-Black.woff2', weight: '900', variable: '--font-display', display: 'swap' });
export const metadata: Metadata = { title: 'منظور | مساحة العمل', description: 'نظام التشغيل والإدارة الداخلية لاستوديو منظور', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl" className={`${thmanyah.variable} ${display.variable}`}><body>{children}</body></html>;
}
