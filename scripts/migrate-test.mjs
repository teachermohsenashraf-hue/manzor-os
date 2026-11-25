import 'dotenv/config';
import { spawn } from 'node:child_process';

const connection = process.env.DIRECT_URL;
if (!connection) throw new Error('DIRECT_URL مطلوب لترحيل مخطط الاختبار');
const url = new URL(connection);
if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('يلزم PostgreSQL');
url.searchParams.set('schema', 'manzoor_test');
const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() };
console.log('تطبيق الترحيلات على manzoor_test فقط');
const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
