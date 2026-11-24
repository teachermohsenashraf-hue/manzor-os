import 'dotenv/config';
import { spawn } from 'node:child_process';

const connection = process.env.DIRECT_URL;
if (!connection) throw new Error('DIRECT_URL مطلوب لتشغيل اختبارات التكامل');
const url = new URL(connection);
if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('يلزم رابط PostgreSQL');
url.searchParams.set('schema', 'manzoor_test');
const env = { ...process.env, TEST_DATABASE_URL: url.toString(), DATABASE_URL: url.toString() };
console.log('تشغيل اختبارات التكامل على مخطط manzoor_test');
const paths = [
  'tests/integration/commerce-db.test.ts',
  'tests/integration/finance-db.test.ts',
  'tests/integration/production-db.test.ts',
];
const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...paths], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
