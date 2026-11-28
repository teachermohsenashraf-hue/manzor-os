import { config } from 'dotenv';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from 'playwright-core';

config({ path: '.env.local', quiet: true });
const url = new URL(process.env.PREVIEW_DATABASE_URL ?? '');
const ref = 'qepccducwytxchzstgsh';
if (!url.hostname.endsWith('.pooler.supabase.com') ||
  url.username !== `manzoor_preview_app.${ref}` ||
  url.pathname !== '/postgres' || url.searchParams.get('schema') !== 'manzoor_test') {
  throw new Error('يتطلب الفحص الدور المحدود ومخطط manzoor_test');
}
const db = new PrismaClient({ adapter: new PrismaPg({
  connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10_000,
}, { schema: 'manzoor_test' }) });
const base = 'http://localhost:3000';
const cookieName = process.env.UX_AUDIT_PRODUCTION_BUILD === '1' ? '__Host-manzoor-session' : 'manzoor-session';
const routes = {
  OWNER: ['/dashboard','/orders','/clients','/projects','/finance/earnings','/finance/expenses','/crm-overview','/leads','/teams','/services','/subscriptions','/commerce-overview','/finance','/production-overview','/users','/audit','/settings','/change-password'],
  COMMUNICATION: ['/dashboard','/orders','/clients','/projects','/finance/earnings','/crm-overview','/leads','/change-password'],
  EXECUTION: ['/dashboard','/projects','/finance/earnings','/change-password'],
};
const output = join('backups', 'ux-audit');
const onlyRoutes = process.env.UX_AUDIT_ROUTES?.split(',').filter(Boolean);
await mkdir(output, { recursive: true });
let browser;
const sessions = [];
const failures = [];
try {
  const users = {};
  for (const role of Object.keys(routes)) {
    const user = await db.user.findFirst({ where: { role, active: true, mustChangePassword: false }, select: { id: true } });
    if (!user) throw new Error(`لا يوجد حساب اختبار نشط للدور ${role}`);
    users[role] = user;
  }
  const [order, project, lead, subscription, executorProject, communicatorProject, communicatorLead] = await Promise.all([
    db.customerOrder.findFirst({ where: { status: 'APPROVED' }, select: { id: true } }),
    db.project.findFirst({ where: { stage: { not: 'COMPLETED' }, cancelledAt: null }, select: { id: true } }),
    db.lead.findFirst({ where: { status: { not: 'CLIENT' } }, select: { id: true } }),
    db.subscription.findFirst({ select: { id: true } }),
    db.project.findFirst({ where: { executorId: users.EXECUTION.id, stage: { not: 'COMPLETED' }, cancelledAt: null }, select: { id: true } }),
    db.project.findFirst({ where: { team: { communicatorId: users.COMMUNICATION.id }, stage: { not: 'COMPLETED' }, cancelledAt: null }, select: { id: true } }),
    db.lead.findFirst({ where: { team: { communicatorId: users.COMMUNICATION.id }, status: { not: 'CLIENT' } }, select: { id: true } }),
  ]);
  const [ownerProjectFallback, ownerLeadFallback, executorProjectFallback, communicatorProjectFallback, communicatorLeadFallback] = await Promise.all([
    project ? null : db.project.findFirst({ select: { id: true } }),
    lead ? null : db.lead.findFirst({ select: { id: true } }),
    executorProject ? null : db.project.findFirst({ where: { executorId: users.EXECUTION.id }, select: { id: true } }),
    communicatorProject ? null : db.project.findFirst({ where: { team: { communicatorId: users.COMMUNICATION.id } }, select: { id: true } }),
    communicatorLead ? null : db.lead.findFirst({ where: { team: { communicatorId: users.COMMUNICATION.id } }, select: { id: true } }),
  ]);
  if (order) routes.OWNER.push(`/orders/${order.id}`);
  if (project || ownerProjectFallback) routes.OWNER.push(`/projects/${(project || ownerProjectFallback).id}`);
  if (executorProject || executorProjectFallback) routes.EXECUTION.push(`/projects/${(executorProject || executorProjectFallback).id}`);
  if (communicatorProject || communicatorProjectFallback) routes.COMMUNICATION.push(`/projects/${(communicatorProject || communicatorProjectFallback).id}`);
  if (lead || ownerLeadFallback) routes.OWNER.push(`/leads/${(lead || ownerLeadFallback).id}`);
  if (communicatorLead || communicatorLeadFallback) routes.COMMUNICATION.push(`/leads/${(communicatorLead || communicatorLeadFallback).id}`);
  if (subscription) routes.OWNER.push(`/subscriptions/${subscription.id}`);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  for (const role of Object.keys(routes)) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.session.create({ data: { tokenHash, userId: users[role].id, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    sessions.push(tokenHash);
    for (const width of [390,768,1440]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ar-EG' });
      await context.addCookies([{ name: cookieName, value: token, url: cookieName.startsWith('__Host-') ? 'https://localhost:3000' : base,
        httpOnly: true, secure: cookieName.startsWith('__Host-'), sameSite: 'Lax' }]);
      const page = await context.newPage();
      for (const route of routes[role]) {
        if (onlyRoutes && !onlyRoutes.some(value => value.endsWith('/*') ? route.startsWith(value.slice(0,-1)) : value === route)) continue;
        try {
          const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await page.locator('main h1').first().waitFor({ timeout: 20_000 });
          const measure = () => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
            rtl: document.documentElement.dir === 'rtl', forms: document.querySelectorAll('main form').length,
            grids: [...document.querySelectorAll('main form.form-grid')].filter(form => getComputedStyle(form).gridTemplateColumns.split(' ').length > 1).length,
            actionOrder: (() => { const actions = document.querySelector('main .dashboard-grid > :is(.project-actions,.order-actions,.lead-actions)'); return actions ? getComputedStyle(actions).order : null; })() }));
          let state;
          try { state = await measure(); }
          catch (error) {
            if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error;
            await page.locator('main h1').first().waitFor({ timeout: 20_000 });
            state = await measure();
          }
          const result = { role, width, route: route.includes('/[id]') ? 'detail' : route.replace(/\/[0-9a-f]{20,}.*/, '/detail'), status: response?.status(), ...state };
          console.log(JSON.stringify(result));
          if (response?.status() !== 200 || new URL(page.url()).pathname !== route || state.overflow || !state.rtl || (width <= 1100 && state.actionOrder !== null && state.actionOrder !== '-1')) failures.push({ ...result, actualPath: new URL(page.url()).pathname });
          if (['/dashboard','/orders','/leads','/projects','/finance/earnings','/finance/expenses'].includes(route))
            await page.screenshot({ path: join(output, `${role.toLowerCase()}-${route.slice(1).replaceAll('/','-')}-${width}.png`), fullPage: false });
          if (/^\/(orders|projects|leads)\//.test(route))
            await page.screenshot({ path: join(output, `${role.toLowerCase()}-${route.split('/')[1]}-detail-${width}.png`), fullPage: false });
          if (route === '/dashboard') {
            if (width <= 900) {
              await page.getByRole('button', { name: 'فتح القائمة' }).click();
              await page.getByRole('dialog', { name: 'قائمة منظور' }).waitFor({ timeout: 10_000 });
              await page.getByRole('button', { name: 'إغلاق القائمة' }).last().click();
              console.log(JSON.stringify({ role, width, drawer: true }));
            }
            if (role === 'OWNER') {
              await page.getByRole('link', { name: 'متابعة الإنتاج' }).click();
              await page.waitForURL('**/projects', { timeout: 20_000 });
              await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
              await page.getByRole('link', { name: /طلبات بانتظار الاعتماد/ }).click();
              await page.waitForURL('**/orders?status=PROPOSED', { timeout: 20_000 });
              await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
              console.log(JSON.stringify({ role, width, actionLinks: true }));
            }
            await page.getByRole('button', { name: 'ابدأ الجولة التعريفية' }).click();
            await page.locator('.tour-spotlight').waitFor({ timeout: 10_000 });
            await page.getByRole('button', { name: 'التالي' }).click();
            await page.locator('[data-tour-step="2"]').waitFor({ timeout: 10_000 });
            await page.locator('.tour-spotlight').waitFor({ timeout: 10_000 });
            await page.getByRole('button', { name: 'تخطي' }).click();
            console.log(JSON.stringify({ role, width, tour: true }));
          }
        } catch (error) {
          const result = { role, width, route, error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
          console.log(JSON.stringify(result));
          failures.push(result);
        }
      }
      await context.close();
    }
  }
  console.log(JSON.stringify({ totalFailures: failures.length, failures }));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  if (sessions.length) await db.session.deleteMany({ where: { tokenHash: { in: sessions } } });
  await db.$disconnect();
}
