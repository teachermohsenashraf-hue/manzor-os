export function runtimeDatabaseUrl(connectionString: string | undefined, env: Record<string, string | undefined>) {
  if (!connectionString || !env.VERCEL_ENV) return connectionString;
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432') {
    url.port = '6543';
    return url.toString();
  }
  return connectionString;
}
