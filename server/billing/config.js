export function billingError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) throw new Error('Billing quota must be a non-negative integer below 1000001.');
  return n;
}

export function minorAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function billingConfig(env = process.env) {
  const origin = env.APP_BASE_URL || env.GAMESTUDIO_PUBLIC_URL || 'http://127.0.0.1:4100';
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('APP_BASE_URL must contain only the public origin.');
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production billing requires an HTTPS APP_BASE_URL.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid APP_BASE_URL protocol.');
  const alipayGateway = env.ALIPAY_SANDBOX === 'true' ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do';
  const plan = (id, name, quota) => ({ id, name, monthlyGenerations: positiveInteger(env[`BILLING_${id.toUpperCase()}_MONTHLY_GENERATIONS`], quota),
    stripe: Object.fromEntries(['monthly', 'yearly'].map(interval => [interval, env[`STRIPE_PRICE_${id.toUpperCase()}_${interval.toUpperCase()}`] || null])),
    alipay: Object.fromEntries(['monthly', 'yearly'].map(interval => [interval, minorAmount(env[`ALIPAY_${id.toUpperCase()}_${interval.toUpperCase()}_AMOUNT`])])),
  });
  return {
    origin: url.origin,
    plans: [plan('free', 'Free', 5), plan('pro', 'Pro', 100), plan('studio', 'Studio', 500)],
    stripe: { secretKey: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      // Explicitly pin the REST contract; webhook snapshot versions can vary because
      // their resource IDs are re-fetched using this version before being trusted.
      apiVersion: '2024-06-20', portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION_ID || '' },
    alipay: { appId: env.ALIPAY_APP_ID || '', sellerId: env.ALIPAY_SELLER_ID || '', privateKey: (env.ALIPAY_PRIVATE_KEY || '').replace(/\\n/g, '\n'), publicKey: (env.ALIPAY_PUBLIC_KEY || '').replace(/\\n/g, '\n'), gateway: alipayGateway },
  };
}

export function providerReady(config, provider) {
  return provider === 'stripe' ? Boolean(config.stripe.secretKey && config.stripe.webhookSecret)
    : provider === 'alipay' ? Boolean(config.alipay.appId && config.alipay.sellerId && config.alipay.privateKey && config.alipay.publicKey) : false;
}

export function selectedPlan(config, id, interval, provider) {
  const plan = config.plans.find(p => p.id === id && p.id !== 'free');
  if (!plan || !['monthly', 'yearly'].includes(interval) || !['stripe', 'alipay'].includes(provider)) throw billingError(400, 'INVALID_BILLING_PLAN', 'Choose a valid paid plan, interval, and payment provider.');
  if (!providerReady(config, provider) || !plan[provider][interval]) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'This payment provider or plan has not been configured.');
  return plan;
}
