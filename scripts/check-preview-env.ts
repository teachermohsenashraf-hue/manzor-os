import { assertPreviewIsolation, isPreviewEnvironment } from '../src/lib/preview-isolation';

if (process.argv.includes('--required') && !isPreviewEnvironment(process.env))
  throw new Error('يلزم تعريف MANZOOR_ENV=preview لفحص بيئة المعاينة');
if (isPreviewEnvironment(process.env)) {
  assertPreviewIsolation(process.env);
  console.log('تم التحقق من عزل قاعدة المعاينة وتخزينها وعنوانها');
}
