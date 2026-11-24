export function requireTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL مطلوب لاختبارات التكامل');
  const url = new URL(value);
  const schema = url.searchParams.get('schema');
  const isolatedSchema = schema === 'manzoor_test';
  const isolatedDatabase = /test/i.test(url.pathname);
  if (!isolatedSchema && !isolatedDatabase) throw new Error('استخدم قاعدة اختبار منفصلة أو مخطط manzoor_test');
  process.env.DATABASE_URL = value;
  return { url: value, schema: isolatedSchema ? 'manzoor_test' : 'public' };
}
