import { config } from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

config({ path: '.env.local', quiet: true });
const connectionString = process.env.PREVIEW_DATABASE_URL;
if (!connectionString) throw new Error('اتصال الاختبار المحدود مطلوب');
const target = new URL(connectionString);
const ref = 'qepccducwytxchzstgsh';
const direct = target.hostname === `db.${ref}.supabase.co` && target.username === 'manzoor_preview_app';
const pooled = target.hostname.endsWith('.pooler.supabase.com') && target.username === `manzoor_preview_app.${ref}`;
if ((!direct && !pooled) || target.pathname !== '/postgres' || target.searchParams.get('schema') !== 'manzoor_test')
  throw new Error('الفحص البصري يتطلب الدور المحدود ومخطط manzoor_test');

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('استخدم before أو after');
const base = `http://localhost:${process.env.OP_TEST_PORT || '3000'}`;
const health = await fetch(`${base}/api/health`);
if (health.status !== 200 || !(await health.json()).ready) throw new Error('التطبيق المحلي غير جاهز');
const output = join('qa', 'ux-2026-11-26', phase);
await mkdir(output, { recursive: true });
const db = new pg.Client({ connectionString });
const tokens = [];
let browser;
let connected = false;
const counts = async () => (await db.query(`SELECT
  (SELECT COUNT(*)::int FROM manzoor_test."CustomerOrder") AS orders,
  (SELECT COUNT(*)::int FROM manzoor_test."Project") AS projects,
  (SELECT COUNT(*)::int FROM manzoor_test."Receipt") AS receipts,
  (SELECT COUNT(*)::int FROM manzoor_test."AuditLog") AS audits`)).rows[0];
try {
  await db.connect();
  connected = true;
  const beforeCounts = await counts();
  const users = await db.query(`SELECT id,role FROM manzoor_test."User" WHERE active=true AND "mustChangePassword"=false AND role IN ('OWNER','COMMUNICATION','EXECUTION') ORDER BY "createdAt" DESC`);
  const routes = {
    OWNER: ['dashboard', 'orders', 'projects'],
    COMMUNICATION: ['dashboard', 'orders', 'projects'],
    EXECUTION: ['dashboard', 'projects'],
  };
  const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-first-run'] });
  for (const role of Object.keys(routes).filter(item => !process.argv[3] || item === process.argv[3])) {
    const user = users.rows.find(row => row.role === role);
    if (!user) throw new Error(`حساب اختبار ${role} غير متاح`);
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.query(`INSERT INTO manzoor_test."Session" ("tokenHash","userId","expiresAt") VALUES ($1,$2,NOW()+INTERVAL '10 minutes')`, [tokenHash, user.id]);
    tokens.push(tokenHash);
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ar-EG', reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'manzoor-session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      for (const route of routes[role]) {
        const response = await page.goto(`${base}/${route}`, { waitUntil: 'domcontentloaded' });
        if (response?.status() !== 200) throw new Error(`${role} /${route} HTTP ${response?.status()}`);
        await page.locator('main h1').first().waitFor();
        await page.locator('main .card').first().waitFor();
        await page.screenshot({ path: join(output, `${role.toLowerCase()}-${route}-${width}.png`), animations: 'disabled' });
        const metrics = await page.evaluate(() => ({ bodyWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, firstCardY: document.querySelector('main .card')?.getBoundingClientRect().y ?? null }));
        console.log(`${phase} ${role} ${route} ${width}: ${JSON.stringify(metrics)}`);
      }
      if (phase === 'after') {
        const routeSteps = {
          OWNER: ['/dashboard', '/orders', '/orders', '/projects', '/dashboard'],
          COMMUNICATION: ['/dashboard', '/orders', '/orders', '/projects'],
          EXECUTION: ['/dashboard', '/projects', '/dashboard'],
        }[role];
        await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'ابدأ الجولة التعريفية' }).click();
        await page.locator('.tour-spotlight').waitFor();
        const spotlight = await page.evaluate(targetName => {
          const target = Array.from(document.querySelectorAll(`[data-tour="${targetName}"]`))
            .map(element => element.getBoundingClientRect()).find(rect => rect.width > 0 && rect.height > 0);
          const spot = document.querySelector('.tour-spotlight')?.getBoundingClientRect();
          return target && spot ? { target: { x: target.x, y: target.y, width: target.width, height: target.height }, spot: { x: spot.x, y: spot.y, width: spot.width, height: spot.height } } : null;
        }, role === 'EXECUTION' ? 'assigned-work' : 'start-order');
        if (!spotlight || spotlight.spot.x >= spotlight.target.x + spotlight.target.width ||
            spotlight.spot.x + spotlight.spot.width <= spotlight.target.x ||
            spotlight.spot.y >= spotlight.target.y + spotlight.target.height ||
            spotlight.spot.y + spotlight.spot.height <= spotlight.target.y)
          throw new Error(`${role} spotlight misses target at ${width}: ${JSON.stringify(spotlight)}`);
        console.log(`Tour focus ${role} ${width}: ${JSON.stringify(spotlight)}`);
        await page.screenshot({ path: join(output, `${role.toLowerCase()}-tour-${width}.png`), animations: 'disabled' });
        for (let step = 1; step < routeSteps.length; step++) {
          await page.getByRole('button', { name: 'التالي' }).click();
          await page.waitForURL(`${base}${routeSteps[step]}`);
          await page.locator(`[data-tour-step="${step + 1}"]`).waitFor();
          await page.locator('.tour-spotlight').waitFor();
          if (new URL(page.url()).pathname !== routeSteps[step]) throw new Error(`${role} tour step ${step + 1} navigated incorrectly`);
          if (step === 1) {
            await page.getByRole('button', { name: 'السابق' }).click();
            await page.waitForURL(`${base}${routeSteps[0]}`);
            await page.locator('[data-tour-step="1"]').waitFor();
            await page.getByRole('button', { name: 'التالي' }).click();
            await page.waitForURL(`${base}${routeSteps[1]}`);
            await page.locator('[data-tour-step="2"]').waitFor();
          }
        }
        await page.getByRole('button', { name: 'إنهاء' }).click();
        if (await page.getByRole('dialog', { name: 'الجولة التعريفية' }).count()) throw new Error(`${role} tour did not close`);
        await page.getByRole('button', { name: 'ابدأ الجولة التعريفية' }).click();
        await page.locator('[data-tour-step="1"]').waitFor();
        await page.getByRole('button', { name: 'تخطي' }).click();
        if (await page.getByRole('dialog', { name: 'الجولة التعريفية' }).count()) throw new Error(`${role} tour skip failed`);
        console.log(`Tour ${role} ${width}: spotlight, next, previous, route changes, replay, skip passed`);
        if (width === 390) {
          await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: 'فتح القائمة' }).click();
          await page.locator('.sidebar.is-open').waitFor();
          await page.screenshot({ path: join(output, `${role.toLowerCase()}-drawer-${width}.png`), animations: 'disabled' });
          if (role !== 'EXECUTION') {
            await page.locator('.nav-extra details').first().locator('summary').click();
            await page.locator('.nav-extra a[href="/leads"]').waitFor();
            await page.screenshot({ path: join(output, `${role.toLowerCase()}-menu-${width}.png`), animations: 'disabled' });
          }
          const navWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          if (navWidth > width) throw new Error(`${role} mobile navigation overflows: ${navWidth}`);
          await page.getByRole('button', { name: 'إغلاق القائمة' }).last().click();
          if (await page.locator('.sidebar.is-open').count()) throw new Error(`${role} mobile drawer did not close`);
        }
      }
      await context.close();
    }
  }
  const afterCounts = await counts();
  if (JSON.stringify(afterCounts) !== JSON.stringify(beforeCounts)) throw new Error('الجولة أو التصوير غيّرا بيانات التشغيل');
} finally {
  await browser?.close();
  if (tokens.length && connected) await db.query(`DELETE FROM manzoor_test."Session" WHERE "tokenHash" = ANY($1::text[])`, [tokens]);
  if (connected) await db.end();
}
