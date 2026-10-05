import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../../server/index.js';

// Cross-module integration, not live provider/AI evidence. Every external request
// is intercepted by the fixtures below. HTTPS is the logical reverse-proxy origin;
// the physical test listener is an ephemeral loopback HTTP port.
const origin = 'https://production-integration.example.test';
const env = {
  GAMESTUDIO_MODE: 'production', GAMESTUDIO_PUBLIC_URL: origin, GAMESTUDIO_PROXY_HOPS: '1',
  GAMESTUDIO_SESSION_SECRET: 'b7987b291417d8dd73e26e4a98786d475afcf11cfd1c3fe94e22a87c8f3b496c',
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'integration-auth-fixture', TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`,
  STRIPE_SECRET_KEY: 'sk_test_integration_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_integration_fixture', STRIPE_PRICE_PRO_MONTHLY: 'price_proMonthly',
  BILLING_FREE_MONTHLY_GENERATIONS: '1', BILLING_PRO_MONTHLY_GENERATIONS: '3',
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

function stripeFixture() {
  const requests = [], sessions = new Map(), subscriptions = new Map(), invoices = new Map();
  let next = 0;
  const fetchImpl = async (url, options = {}) => {
    const target = new URL(url), body = Object.fromEntries(new URLSearchParams(options.body || ''));
    assert.equal(target.origin, 'https://api.stripe.com', 'no external fetch fallback is allowed');
    assert.equal(options.headers.Authorization, `Bearer ${env.STRIPE_SECRET_KEY}`);
    assert.equal(options.headers['Stripe-Version'], '2024-06-20');
    requests.push({ path: target.pathname, method: options.method, body, headers: options.headers });
    if (target.pathname === '/v1/prices/price_proMonthly') return response({ id: 'price_proMonthly', active: true, type: 'recurring', unit_amount: 1900, currency: 'usd', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
    if (target.pathname === '/v1/customers') return response({ id: 'cus_' + body['metadata[gamestudio_user_id]'].replaceAll('-', '') });
    if (target.pathname === '/v1/checkout/sessions') {
      assert.equal(body.mode, 'subscription'); assert.equal(body['line_items[0][price]'], 'price_proMonthly'); assert.equal(body['line_items[0][quantity]'], '1');
      const id = 'cs_integration' + (++next), session = { id, status: 'open', mode: 'subscription', url: 'https://checkout.stripe.com/c/pay/' + id,
        customer: body.customer, client_reference_id: body.client_reference_id, subscription: null, payment_status: 'unpaid',
        metadata: { gamestudio_order_id: body['metadata[gamestudio_order_id]'], gamestudio_user_id: body['metadata[gamestudio_user_id]'] } };
      assert.equal(body['subscription_data[metadata][gamestudio_order_id]'], session.metadata.gamestudio_order_id);
      assert.equal(body['subscription_data[metadata][gamestudio_user_id]'], session.client_reference_id);
      sessions.set(id, session); return response(session);
    }
    if (target.pathname.startsWith('/v1/checkout/sessions/')) { const value = sessions.get(target.pathname.split('/')[4]); assert.ok(value); return response(value); }
    if (target.pathname.startsWith('/v1/subscriptions/')) { const value = subscriptions.get(target.pathname.split('/')[3]); assert.ok(value); return response(value); }
    if (target.pathname.startsWith('/v1/invoices/')) { const value = invoices.get(target.pathname.split('/')[3]); assert.ok(value); return response(value); }
    throw new Error(`Unexpected mocked Stripe request: ${options.method} ${target.pathname}`);
  };
  function settle(order, userId) {
    const session = [...sessions.values()].find(value => value.metadata.gamestudio_order_id === order.id);
    assert.ok(session); assert.equal(session.client_reference_id, userId);
    const suffix = ++next, subscriptionId = 'sub_integration' + suffix, invoiceId = 'in_integration' + suffix, start = Math.floor(Date.now() / 1000);
    session.status = 'complete'; session.payment_status = 'paid'; session.subscription = subscriptionId;
    subscriptions.set(subscriptionId, { id: subscriptionId, status: 'active', customer: session.customer, cancel_at_period_end: false, current_period_start: start, current_period_end: start + 30 * 86400,
      metadata: { gamestudio_order_id: order.id, gamestudio_user_id: userId }, items: { data: [{ quantity: 1, price: { id: 'price_proMonthly' } }] }, latest_invoice: invoiceId });
    invoices.set(invoiceId, { id: invoiceId, customer: session.customer, subscription: subscriptionId, status: 'paid', paid: true, paid_out_of_band: false, amount_paid: 1900, amount_due: 1900, currency: 'usd',
      lines: { data: [{ price: { id: 'price_proMonthly' }, quantity: 1, proration: false, period: { start, end: start + 30 * 86400 } }], has_more: false },
      status_transitions: { paid_at: start }, hosted_invoice_url: 'https://invoice.stripe.com/i/' + invoiceId });
    return invoiceId;
  }
  return { fetch: fetchImpl, settle, requests };
}

async function transport(base, route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(base + route, { method, headers: { Host: new URL(origin).host, 'X-Forwarded-Proto': 'https', ...headers } }, result => {
      const responseHeaders = new Headers();
      for (let i = 0; i < result.rawHeaders.length; i += 2) responseHeaders.append(result.rawHeaders[i], result.rawHeaders[i + 1]);
      resolve(new Response([204, 304].includes(result.statusCode) ? null : Readable.toWeb(result), { status: result.statusCode, headers: responseHeaders }));
    });
    request.once('error', reject); request.end(body);
  });
}

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-billing-auth-')), provider = stripeFixture();
  const successRelease = path.join(dir, 'success.release'), failureRelease = path.join(dir, 'failure.release'), cli = path.join(dir, 'generation-fixture.mjs');
  fs.writeFileSync(cli, `#!${process.execPath}\nimport fs from 'node:fs';
const args=process.argv.slice(2); let prompt=''; for await(const chunk of process.stdin)prompt+=chunk;
if(args[args.indexOf('-m')+1]!=='gpt-6.1-sol')process.exit(41);
const release=prompt.includes('INTEGRATION_HOLD_FAIL')?${JSON.stringify(failureRelease)}:prompt.includes('INTEGRATION_HOLD_SUCCESS')?${JSON.stringify(successRelease)}:null;
if(release)while(!fs.existsSync(release))await new Promise(resolve=>setTimeout(resolve,20));
if(prompt.includes('INTEGRATION_HOLD_FAIL')){console.error('Intentional integration transport failure');process.exit(17);}
const html='<!doctype html><html><head><title>Integration game</title></head><body><button id="play">Play</button><output id="score">0</output><script>let score=0;document.querySelector("#play").onclick=()=>document.querySelector("#score").textContent=++score;</script></body></html>';
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({title:'Integration game',summary:'Deterministic transport fixture',controls:'Click Play',html}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:20}}));\n`, { mode: 0o700 });
  const authFetch = async (url, options) => {
    assert.ok(String(url).startsWith(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/`), 'auth fixtures never send an actual SMS');
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'));
    const body = new URLSearchParams(options.body);
    return response({ sid: `VE${'3'.repeat(32)}`, service_sid: env.TWILIO_VERIFY_SERVICE_SID, to: body.get('To'), status: String(url).endsWith('/Verifications') ? 'pending' : body.get('Code') === '123456' ? 'approved' : 'pending' });
  };
  // Deliberately use the DEFAULT billing mount: no installBilling override/spies.
  const app = createApp({ dataDir: dir, seed: false, env, authFetch, billingFetch: provider.fetch, codexBin: cli, timeoutMs: 5000,
    healthCheck: async () => ({ available: true, authenticated: true, version: 'integration-transport-fixture' }) });
  assert.ok(app.locals.billing.ledger, 'production default mount must expose its real durable billing ledger');
  const server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener)); listener.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await app.locals.studio.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  function client() {
    const jar = new Map(); let csrfToken;
    async function request(route, { method = 'GET', body, expected = 200, csrf = true, raw = false, headers = {} } = {}) {
      const result = await transport(base, route, { method, headers: { Origin: origin, ...(jar.size ? { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        ...(csrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const cookie of result.headers.getSetCookie()) { const pair = cookie.split(';')[0], index = pair.indexOf('='); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
      assert.equal(result.status, expected, `${method} ${route}: ${result.status === expected ? '' : await result.clone().text()}`);
      if (raw) return result;
      const text = await result.text(), data = text ? JSON.parse(text) : undefined;
      if (data?.csrfToken) csrfToken = data.csrfToken;
      return data;
    }
    async function login(phone) { await request('/api/auth/session'); await request('/api/auth/phone/send', { method: 'POST', body: { phone } }); return request('/api/auth/phone/verify', { method: 'POST', body: { phone, code: '123456' } }); }
    return { request, login };
  }
  async function webhook(invoiceId, { id = 'evt_' + randomUUID().replaceAll('-', ''), forged = false } = {}) {
    const raw = Buffer.from('{ "id":' + JSON.stringify(id) + ', "type":"invoice.paid", "data":{"object":{"id":' + JSON.stringify(invoiceId) + '}} }');
    const timestamp = Math.floor(Date.now() / 1000), signature = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.').update(raw).digest('hex');
    const result = await transport(base, '/api/billing/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${forged ? '0'.repeat(64) : signature}` }, body: raw });
    assert.equal(result.status, forged ? 400 : 200, await result.clone().text()); return result.json();
  }
  const purchase = async account => account.request('/api/billing/checkout', { method: 'POST', expected: 201, headers: { 'Idempotency-Key': randomUUID() }, body: { provider: 'stripe', planId: 'pro', interval: 'monthly' } });
  return { app, provider, client, webhook, purchase, releaseSuccess: () => fs.writeFileSync(successRelease, 'release'), releaseFailure: () => fs.writeFileSync(failureRelease, 'release') };
}

async function completed(account, id) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const job = await account.request('/api/jobs/' + id); if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job; await wait(20); }
  assert.fail('Integration generation did not reach a terminal state.');
}

test('default production billing connects phone sessions, CSRF, raw verified settlement and separate tenant memberships', async t => {
  const s = await setup(t), guest = s.client(), a = s.client(), b = s.client();
  const plans = await guest.request('/api/billing/plans'); assert.equal(plans.providers.stripe.available, true);
  await guest.request('/api/billing/status', { expected: 401 }); await guest.request('/api/billing/history', { expected: 401 });
  await guest.request('/api/billing/checkout', { method: 'POST', expected: 401, body: { provider: 'stripe', planId: 'pro', interval: 'monthly' }, headers: { 'Idempotency-Key': randomUUID() } });
  await guest.request('/api/billing/portal', { method: 'POST', expected: 401 });
  const alice = await a.login('+14155552671'), bob = await b.login('+14155552672'); assert.notEqual(alice.user.id, bob.user.id);
  await a.request('/api/billing/checkout', { method: 'POST', csrf: false, expected: 403, body: { provider: 'stripe', planId: 'pro', interval: 'monthly' }, headers: { 'Idempotency-Key': randomUUID() } });
  const order = await s.purchase(a); assert.match(order.checkoutUrl, /^https:\/\/checkout.stripe.com\//); assert.equal((await a.request('/api/billing/status')).planId, 'free');
  const returned = await guest.request('/api/billing/return?order=' + order.id, { expected: 303, raw: true }); assert.ok(returned.headers.get('location').includes(order.id));
  assert.equal((await a.request('/api/billing/status')).planId, 'free', 'a browser return never grants paid membership');
  const invoiceId = s.provider.settle(order, alice.user.id); await s.webhook(invoiceId, { forged: true }); assert.equal((await a.request('/api/billing/status')).planId, 'free');
  const eventId = 'evt_defaultMount'; await s.webhook(invoiceId, { id: eventId });
  const membership = await a.request('/api/billing/status'); assert.equal(membership.planId, 'pro'); assert.equal(membership.monthlyGenerations, 3); assert.equal(membership.usage.remaining, 3);
  assert.equal((await b.request('/api/billing/status')).planId, 'free'); assert.equal((await b.request('/api/billing/status')).usage.remaining, 1);
  const before = await a.request('/api/billing/history'); assert.equal(before.payments.length, 1); assert.equal(before.payments[0].id, invoiceId); assert.equal(before.orders[0].id, order.id);
  assert.equal((await s.webhook(invoiceId, { id: eventId })).duplicate, true); const after = await a.request('/api/billing/history'); assert.deepEqual(after, before);
  await b.request('/api/billing/orders/' + order.id, { expected: 404 });
  await b.request('/api/billing/orders/' + order.id + '/cancel', { method: 'POST', expected: 404 });
  assert.deepEqual(await b.request('/api/billing/history'), { payments: [], orders: [] });
  const owned = await a.request('/api/billing/orders/' + order.id); assert.equal(owned.status, 'paid'); assert.equal(owned.subscriptionId, membership.subscriptionId);
});

test('default production generation admits through the real membership ledger and settles success/failure independently for each tenant', async t => {
  const s = await setup(t), a = s.client(), b = s.client(), alice = await a.login('+14155552671'); await b.login('+14155552672');
  const pa = await a.request('/api/projects', { method: 'POST', body: { name: 'Held success' }, expected: 201 });
  const second = await a.request('/api/projects', { method: 'POST', body: { name: 'Quota rejection then failure' }, expected: 201 });
  const pb = await b.request('/api/projects', { method: 'POST', body: { name: 'Other account' }, expected: 201 });
  const success = await a.request(`/api/projects/${pa.id}/jobs`, { method: 'POST', expected: 202, body: { prompt: 'INTEGRATION_HOLD_SUCCESS create a playable game', mode: 'generate' } });
  let quota = await a.request('/api/billing/status'); assert.equal(quota.usage.reserved, 1); assert.equal(quota.usage.used, 0); assert.equal(quota.usage.remaining, 0);
  const rejected = await a.request(`/api/projects/${second.id}/jobs`, { method: 'POST', expected: 402, body: { prompt: 'A second game must not bypass quota', mode: 'generate' } }); assert.equal(rejected.error, 'GENERATION_QUOTA_EXCEEDED');
  const untouched = await a.request('/api/projects/' + second.id); assert.deepEqual(untouched.messages, second.messages); assert.deepEqual(untouched.nodes, second.nodes); assert.deepEqual(untouched.versions, []);
  assert.equal((await a.request('/api/jobs')).jobs.length, 1); assert.equal((await b.request('/api/billing/status')).usage.remaining, 1);
  const other = await b.request(`/api/projects/${pb.id}/jobs`, { method: 'POST', expected: 202, body: { prompt: 'Create a simple game for the other tenant', mode: 'generate' } });
  assert.equal((await b.request('/api/billing/status')).usage.reserved, 1); await b.request('/api/jobs/' + success.id, { expected: 404 });
  s.releaseSuccess(); assert.equal((await completed(a, success.id)).status, 'succeeded'); assert.equal((await completed(b, other.id)).status, 'succeeded');
  quota = await a.request('/api/billing/status'); assert.equal(quota.usage.used, 1); assert.equal(quota.usage.reserved, 0); assert.equal(quota.usage.remaining, 0);
  assert.equal((await b.request('/api/billing/status')).usage.used, 1); assert.equal((await a.request('/api/projects/' + pa.id)).versions.length, 1);
  const order = await s.purchase(a); await s.webhook(s.provider.settle(order, alice.user.id));
  quota = await a.request('/api/billing/status'); assert.equal(quota.planId, 'pro'); assert.equal(quota.usage.used, 1); assert.equal(quota.usage.remaining, 2);
  const failure = await a.request(`/api/projects/${second.id}/jobs`, { method: 'POST', expected: 202, body: { prompt: 'INTEGRATION_HOLD_FAIL intentional transport failure', mode: 'generate' } });
  quota = await a.request('/api/billing/status'); assert.equal(quota.usage.reserved, 1); assert.equal(quota.usage.remaining, 1);
  s.releaseFailure(); assert.equal((await completed(a, failure.id)).status, 'failed');
  quota = await a.request('/api/billing/status'); assert.equal(quota.usage.used, 1); assert.equal(quota.usage.reserved, 0); assert.equal(quota.usage.remaining, 2);
  const retry = await a.request(`/api/projects/${second.id}/jobs`, { method: 'POST', expected: 202, body: { prompt: 'A fresh successful request after the failed reservation was released', mode: 'generate' } });
  assert.equal((await completed(a, retry.id)).status, 'succeeded'); assert.equal((await a.request('/api/billing/status')).usage.used, 2);
  assert.equal((await b.request('/api/billing/status')).usage.used, 1, 'other account usage is unchanged by paid upgrade or retry');
});
