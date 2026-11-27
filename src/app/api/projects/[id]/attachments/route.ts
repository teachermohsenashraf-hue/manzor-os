import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Historical attachments remain available through their read-only download route
// New production files are handled outside MANZOOR OS through WhatsApp
const disabled = () => NextResponse.json(
  { error: 'حفظ ملفات الإنتاج داخل النظام متوقف، أرسل الملفات عبر واتساب وسجل الحالة فقط' },
  { status: 410, headers: { 'Cache-Control': 'no-store' } },
);

export const POST = disabled;
export const PUT = disabled;
