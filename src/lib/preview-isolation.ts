const productionRef = 'qepccducwytxchzstgsh';
const previewRole = 'manzoor_preview_app';

type PreviewEnvironment = Record<string, string | undefined>;

export function isPreviewEnvironment(env: PreviewEnvironment) {
  return env.VERCEL_ENV === 'preview' || env.MANZOOR_ENV === 'preview';
}

export function appOrigin(env: PreviewEnvironment) {
  if (env.MANZOOR_ENV === 'preview' && env.VERCEL_ENV === 'preview' && env.VERCEL_URL)
    return `https://${env.VERCEL_URL}`;
  return env.APP_ORIGIN;
}

export function assertPreviewIsolation(env: PreviewEnvironment) {
  if (!isPreviewEnvironment(env)) return;
  if (env.MANZOOR_ENV !== 'preview') throw new Error('بيئة المعاينة غير مضبوطة');

  const supabase = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/.exec(env.SUPABASE_URL ?? '');
  const ref = supabase?.[1];
  if (ref !== productionRef)
    throw new Error('المعاينة تتطلب مشروع Supabase المعتمد');
  if (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('المعاينة التشغيلية لا تستخدم مفتاح تخزين خاص');

  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    let url: URL;
    try { url = new URL(env[name] ?? ''); }
    catch { throw new Error(`رابط ${name} للمعاينة غير صالح`); }
    const restrictedDirect = url.hostname === `db.${ref}.supabase.co` && url.username === previewRole;
    const restrictedPooled = url.hostname.endsWith('.pooler.supabase.com') &&
      url.username === `${previewRole}.${ref}`;
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.searchParams.get('schema') !== 'manzoor_test' ||
        url.pathname !== '/postgres' || (!restrictedDirect && !restrictedPooled))
      throw new Error(`رابط ${name} يجب أن يستخدم الدور المحدود ${previewRole} ومخطط manzoor_test فقط`);
  }

  let origin: URL;
  let configuredOrigin: URL | undefined;
  try {
    origin = new URL(appOrigin(env) ?? '');
    configuredOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : undefined;
  }
  catch { throw new Error('APP_ORIGIN للمعاينة غير صالح'); }
  if (configuredOrigin && env.VERCEL_ENV === 'preview' && configuredOrigin.origin !== origin.origin)
    throw new Error('APP_ORIGIN لا يطابق عنوان نشر المعاينة');
  if (origin.origin === 'https://manzor-os.vercel.app' ||
      (env.VERCEL_ENV && origin.protocol !== 'https:'))
    throw new Error('APP_ORIGIN للمعاينة يجب أن يكون عنوانها المستقل');
}
