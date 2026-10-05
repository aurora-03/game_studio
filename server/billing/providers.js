import { createHmac, timingSafeEqual, createSign, createVerify } from 'node:crypto';
import { billingError, minorAmount } from './config.js';

export function verifyStripeSignature(raw, signature, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || !secret || typeof signature !== 'string') throw billingError(400, 'INVALID_PAYMENT_SIGNATURE', 'Invalid payment notification signature.');
  const fields = signature.split(',').map(v => v.split('='));
  const times = fields.filter(([key]) => key === 't').map(([, value]) => value);
  if (times.length !== 1 || !/^\d+$/.test(times[0]) || Math.abs(now / 1000 - Number(times[0])) > 300) throw billingError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment notification timestamp is outside the allowed window.');
  const expected = createHmac('sha256', secret).update(times[0] + '.').update(raw).digest();
  const valid = fields.filter(([key]) => key === 'v1').some(([, value]) => /^[a-f0-9]{64}$/i.test(value || '') && timingSafeEqual(expected, Buffer.from(value, 'hex')));
  if (!valid) throw billingError(400, 'INVALID_PAYMENT_SIGNATURE', 'Invalid payment notification signature.');
  try { return JSON.parse(raw.toString('utf8')); } catch { throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid payment notification body.'); }
}

export function alipayCanonical(params, omitSignType = true) {
  return Object.keys(params).filter(key => key !== 'sign' && (!omitSignType || key !== 'sign_type') && params[key] !== '' && params[key] !== undefined && params[key] !== null)
    .sort().map(key => `${key}=${params[key]}`).join('&');
}

export function verifyAlipayNotification(params, config) {
  if (!params || typeof params !== 'object' || Object.values(params).some(v => typeof v !== 'string') || params.sign_type !== 'RSA2' || !params.sign) throw billingError(400, 'INVALID_PAYMENT_SIGNATURE', 'Invalid Alipay notification signature.');
  let valid = false;
  try { valid = createVerify('RSA-SHA256').update(alipayCanonical(params)).verify(config.publicKey, params.sign, 'base64'); } catch { /* Invalid configured or supplied key/signature. */ }
  if (!valid) throw billingError(400, 'INVALID_PAYMENT_SIGNATURE', 'Invalid Alipay notification signature.');
  if (params.app_id !== config.appId || params.seller_id !== config.sellerId) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The notification belongs to a different Alipay application or seller.');
}

// Alipay signs the exact response JSON substring, not a JSON re-serialization.
// Scan the top-level document to retain whitespace, escapes and field order.
export function rawJsonProperty(source, wanted) {
  let pos = 0;
  const skip = () => { while (/\s/.test(source[pos] || '') && pos < source.length) pos++; };
  const stringEnd = () => { const start = pos++; while (pos < source.length) { if (source[pos] === '\\') pos += 2; else if (source[pos++] === '"') return source.slice(start, pos); } throw new Error('Invalid JSON string.'); };
  const valueEnd = () => {
    if (source[pos] === '"') { stringEnd(); return; }
    if (source[pos] === '{' || source[pos] === '[') {
      const stack = [source[pos++] === '{' ? '}' : ']'];
      while (stack.length && pos < source.length) {
        const ch = source[pos];
        if (ch === '"') stringEnd();
        else if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); pos++; }
        else if (ch === '}' || ch === ']') { if (stack.pop() !== ch) throw new Error('Invalid JSON nesting.'); pos++; }
        else pos++;
      }
      if (stack.length) throw new Error('Incomplete JSON.');
      return;
    }
    while (pos < source.length && !/[},\]\s]/.test(source[pos])) pos++;
  };
  skip(); if (source[pos++] !== '{') throw new Error('Expected JSON object.');
  let result = null;
  const seen = new Set();
  while (pos < source.length) {
    skip(); if (source[pos] === '}') break;
    if (source[pos] !== '"') throw new Error('Expected JSON key.');
    const key = JSON.parse(stringEnd());
    if (seen.has(key)) throw new Error('Duplicate JSON property.'); seen.add(key);
    skip(); if (source[pos++] !== ':') throw new Error('Expected colon.'); skip();
    const start = pos; valueEnd();
    if (key === wanted) result = source.slice(start, pos);
    skip(); if (source[pos] === '}') break;
    if (source[pos++] !== ',') throw new Error('Expected comma.');
  }
  JSON.parse(source); return result;
}

function signAlipay(params, config) {
  return { ...params, sign: createSign('RSA-SHA256').update(alipayCanonical(params, false)).sign(config.privateKey, 'base64') };
}

export function alipayTimestamp(time) {
  // Alipay's v2 gateway expects Beijing time, independent of the server timezone.
  return new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

async function responseText(response) {
  const length = Number(response.headers?.get('content-length'));
  if (length > 2000000) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Payment provider response exceeded the allowed size.');
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 2000000) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Payment provider response exceeded the allowed size.');
    return raw;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2000000) { await reader.cancel(); throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Payment provider response exceeded the allowed size.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function paymentProviders(config, fetcher = globalThis.fetch, now = Date.now, signalForRequest = () => null) {
  const signal = () => { const current = signalForRequest(); return current ? AbortSignal.any([AbortSignal.timeout(15000), current]) : AbortSignal.timeout(15000); };
  async function stripe(path, { method = 'GET', params, idempotencyKey } = {}) {
    if (!/^\/[a-zA-Z0-9/_?=&\[\]%.:-]+$/.test(path)) throw new Error('Unsafe Stripe API path.');
    const form = params ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])) : null;
    let response;
    try { response = await fetcher('https://api.stripe.com/v1' + path, { method, headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Stripe-Version': config.stripe.apiVersion,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: form?.toString(), signal: signal() }); }
    catch { throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe is temporarily unavailable. Please retry.'); }
    let data; try { data = JSON.parse(await responseText(response)); } catch { throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Invalid response from Stripe.'); }
    if (!response.ok) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe could not complete the request. Please retry or contact support.');
    return data;
  }
  function alipayParams(method, biz) {
    return { app_id: config.alipay.appId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', timestamp: alipayTimestamp(now()), version: '1.0', biz_content: JSON.stringify(biz) };
  }
  function alipayCheckout(order) {
    const signed = signAlipay({ ...alipayParams('alipay.trade.page.pay', { out_trade_no: order.merchant_order_id, product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: (order.amount / 100).toFixed(2), subject: `GameStudio ${order.plan_id} ${order.interval}`, time_expire: alipayTimestamp(order.expires_at) }),
      notify_url: config.origin + '/api/billing/webhooks/alipay', return_url: config.origin + '/api/billing/return?order=' + order.id }, config.alipay);
    return config.alipay.gateway + '?' + new URLSearchParams(signed).toString();
  }
  async function alipay(method, biz) {
    const params = signAlipay(alipayParams(method, biz), config.alipay);
    let response;
    try { response = await fetcher(config.alipay.gateway, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(params).toString(), signal: signal() }); }
    catch { throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Alipay is temporarily unavailable. Please retry.'); }
    if (!response.ok) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Alipay could not complete the request.');
    const raw = await responseText(response), property = method.replaceAll('.', '_') + '_response';
    let data;
    try {
      const parsed = JSON.parse(raw), signedPart = rawJsonProperty(raw, property);
      if (!signedPart || !parsed.sign || !createVerify('RSA-SHA256').update(signedPart).verify(config.alipay.publicKey, parsed.sign, 'base64')) throw new Error('Invalid signed response.');
      data = parsed[property];
    } catch { throw billingError(502, 'INVALID_PROVIDER_SIGNATURE', 'The Alipay response could not be verified.'); }
    if (data.code !== '10000') {
      if (['alipay.trade.query', 'alipay.trade.close'].includes(method) && data.sub_code === 'ACQ.TRADE_NOT_EXIST') return null;
      throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Alipay could not complete the request. Please retry or contact support.');
    }
    return data;
  }
  return { stripe, alipay, alipayCheckout };
}

export function verifiedAlipayAmount(value, expected) {
  if (minorAmount(value) !== expected) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The payment amount does not match the order.');
}
