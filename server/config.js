function integer(value, fallback, min, max, name) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
export function loadConfig(env = process.env, overrides = {}) {
  const mode = overrides.mode || env.GAMESTUDIO_MODE || 'local';
  if (!['local', 'production'].includes(mode)) throw new Error('GAMESTUDIO_MODE must be local or production');
  let publicOrigin = overrides.publicOrigin || env.GAMESTUDIO_PUBLIC_URL || '';
  if (mode === 'production') {
    let url; try { url = new URL(publicOrigin); } catch { throw new Error('Production requires GAMESTUDIO_PUBLIC_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('GAMESTUDIO_PUBLIC_URL must be an HTTPS origin');
    publicOrigin = url.origin;
  }
  const sessionSecret = overrides.sessionSecret || env.GAMESTUDIO_SESSION_SECRET || '';
  if (mode === 'production' && (Buffer.byteLength(sessionSecret) < 32 || /^(change|example|replace)/i.test(sessionSecret))) throw new Error('Production requires a random GAMESTUDIO_SESSION_SECRET of at least 32 bytes');
  const config = {
    mode, production: mode === 'production', publicOrigin, sessionSecret,
    host: mode === 'production' ? env.GAMESTUDIO_HOST || '127.0.0.1' : '127.0.0.1',
    maxProjects: integer(env.GAMESTUDIO_MAX_PROJECTS, 100, 1, 1000, 'GAMESTUDIO_MAX_PROJECTS'),
    maxJobHistory: integer(env.GAMESTUDIO_MAX_JOB_HISTORY, 1000, 1, 10000, 'GAMESTUDIO_MAX_JOB_HISTORY'),
    maxTenantBytes: integer(env.GAMESTUDIO_MAX_TENANT_BYTES, 1073741824, 1048576, 107374182400, 'GAMESTUDIO_MAX_TENANT_BYTES'),
    sessionLifetimeMs: integer(env.GAMESTUDIO_SESSION_HOURS, 168, 1, 720, 'GAMESTUDIO_SESSION_HOURS') * 3600000,
    trustProxy: integer(env.GAMESTUDIO_PROXY_HOPS, 0, 0, 3, 'GAMESTUDIO_PROXY_HOPS'),
    dataDir: overrides.dataDir || env.GAMESTUDIO_DATA_DIR,
    google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
    twilio: { accountSid: env.TWILIO_ACCOUNT_SID || '', authToken: env.TWILIO_AUTH_TOKEN || '', serviceSid: env.TWILIO_VERIFY_SERVICE_SID || '' },
    phoneCountries: (env.GAMESTUDIO_PHONE_COUNTRIES || '').split(',').map(s => s.trim()).filter(Boolean),
  };
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.host)) throw new Error('Invalid GAMESTUDIO_HOST');
  config.google.enabled = Boolean(config.google.clientId && config.google.clientSecret);
  config.twilio.enabled = Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.serviceSid);
  if (config.twilio.enabled && (!/^AC[a-f0-9]{32}$/i.test(config.twilio.accountSid) || !/^VA[a-f0-9]{32}$/i.test(config.twilio.serviceSid))) throw new Error('Invalid Twilio Account / Verify Service SID');
  if (config.phoneCountries.some(prefix => !/^\+[1-9]\d{0,3}$/.test(prefix))) throw new Error('GAMESTUDIO_PHONE_COUNTRIES must contain country calling codes, e.g. +1,+86');
  return config;
}
