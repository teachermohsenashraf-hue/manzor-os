import { spawn } from 'node:child_process';
import { assertPreviewIsolation } from '../src/lib/preview-isolation';

assertPreviewIsolation(process.env);
if (process.env.MANZOOR_ENV !== 'preview') throw new Error('ترحيلات المعاينة تتطلب MANZOOR_ENV=preview');
console.log('تطبيق الترحيلات على manzoor_test فقط');
const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  env: process.env, stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
