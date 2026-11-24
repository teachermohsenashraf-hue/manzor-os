import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'منظور | مساحة العمل', description: 'نظام التشغيل والإدارة الداخلية لاستوديو منظور', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><head><link rel="preconnect" href="https://framerusercontent.com" crossOrigin="anonymous"/></head><body>{children}</body></html>;
}
