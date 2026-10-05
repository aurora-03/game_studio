import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, createSign, createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createBilling } from '../../server/billing/index.js';
import { minorAmount } from '../../server/billing/config.js';
import { alipayCanonical, alipayTimestamp, rawJsonProperty, verifyStripeSignature } from '../../server/billing/providers.js';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const appKeys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const user = { id: 'user_alice', email: 'alice@example.test', name: 'Alice' };

function setup(t, overrides = {}) {
  const db = overrides.db || new DatabaseSync(':memory:');
  let time = Date.UTC(2026, 0, 31, 12);
  const env = { APP_BASE_URL: 'https://studio.example.test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_PRICE_PRO_MONTHLY: 'price_proMonthly', STRIPE_PRICE_PRO_YEARLY: 'price_proYearly', STRIPE_PRICE_STUDIO_MONTHLY: 'price_studioMonthly', STRIPE_PRICE_STUDIO_YEARLY: 'price_studioYearly',
    ALIPAY_APP_ID: 'app123', ALIPAY_SELLER_ID: 'seller123', ALIPAY_PRIVATE_KEY: appKeys.privateKey, ALIPAY_PUBLIC_KEY: pair.publicKey,
    ALIPAY_PRO_MONTHLY_AMOUNT: '129.00', ALIPAY_PRO_YEARLY_AMOUNT: '1290.00', ALIPAY_STUDIO_MONTHLY_AMOUNT: '399.00', ALIPAY_STUDIO_YEARLY_AMOUNT: '3990.00',
    ...overrides.env };
  const requests = [], sessions = new Map(), subscriptions = new Map(), invoices = new Map(), charges = new Map(), disputes = new Map(), alipayTrades = new Map(), portalConfigs = new Map(), intents = new Map(), voidRaces = new Map(), expireRaces = new Map();
  let unsignedAlipay = false, count = 0, failCheckout = false, pausedCheckout = null, pauseEntered = null, pausedAlipay = null, alipayPauseEntered = null;
  const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  async function fetcher(url, options) {
    const target = new URL(url), params = Object.fromEntries(new URLSearchParams(options.body || ''));
    requests.push({ url, options, params });
    if (target.hostname === 'api.stripe.com') {
      assert.equal(options.headers.Authorization, 'Bearer sk_test_fixture');
      assert.equal(options.headers['Stripe-Version'], '2024-06-20');
      const pathname = target.pathname.slice(3);
      if (pathname.startsWith('/prices/')) {
        const id = pathname.slice(8), yearly = id.endsWith('Yearly');
        return response({ id, active: true, type: 'recurring', unit_amount: id.includes('studio') ? yearly ? 59000 : 5900 : yearly ? 19000 : 1900, currency: 'usd', billing_scheme: 'per_unit', recurring: { interval: yearly ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' } });
      }
      if (pathname === '/customers') return response({ id: 'cus_' + params['metadata[gamestudio_user_id]'].replaceAll('_', '') });
      if (pathname === '/checkout/sessions') {
        if (failCheckout) { failCheckout = false; return new Response('{"error":{"message":"fixture outage"}}', { status: 500 }); }
        if (pausedCheckout) { pauseEntered?.(); await pausedCheckout; pausedCheckout = null; }
        const id = 'cs_fixture' + (++count), orderId = params['metadata[gamestudio_order_id]'];
        const session = { id, url: 'https://checkout.stripe.com/c/pay/' + id, customer: params.customer, client_reference_id: params.client_reference_id,
          metadata: { gamestudio_order_id: orderId, gamestudio_user_id: params.client_reference_id }, subscription: null, status: 'open' };
        sessions.set(id, session); return response(session);
      }
      if (/^\/checkout\/sessions\/cs_[A-Za-z0-9]+\/expire$/.test(pathname)) {
        const id = pathname.split('/')[3], session = sessions.get(id), race = expireRaces.get(id); if (race) { expireRaces.delete(id); race(); }
        if (session.status !== 'open') return new Response('{"error":"Checkout is not open"}', { status: 400 }); session.status = 'expired'; return response(session);
      }
      if (pathname.startsWith('/checkout/sessions/')) return response(sessions.get(pathname.split('/')[3]));
      if (pathname.startsWith('/subscriptions/')) {
        const sub = subscriptions.get(pathname.split('/')[2]);
        if (options.method === 'POST') sub.cancel_at_period_end = params.cancel_at_period_end === 'true';
        if (options.method === 'DELETE') sub.status = 'canceled';
        return response(sub);
      }
      if (/^\/invoices\/in_[A-Za-z0-9]+\/void$/.test(pathname)) {
        const id = pathname.split('/')[2], invoice = invoices.get(id), race = voidRaces.get(id);
        if (race) { voidRaces.delete(id); race(); }
        if (!['open', 'uncollectible'].includes(invoice.status)) return new Response('{"error":"Invoice cannot be voided"}', { status: 400 });
        invoice.status = 'void'; invoice.amount_due = 0; invoice.paid = false;
        if (invoice.payment_intent) intents.get(invoice.payment_intent).status = 'canceled';
        return response(invoice);
      }
      if (pathname.startsWith('/invoices/')) return response(invoices.get(pathname.split('/')[2]));
      if (pathname.startsWith('/payment_intents/')) return response(intents.get(pathname.split('/')[2]));
      if (pathname.startsWith('/charges/')) return response(charges.get(pathname.split('/')[2]));
      if (pathname.startsWith('/disputes/')) return response(disputes.get(pathname.split('/')[2]));
      if (pathname === '/billing_portal/configurations') {
        const id = 'bpc_fixture' + (++count), configuration = { id, active: true, is_default: false, features: {
          customer_update: { enabled: params['features[customer_update][enabled]'] === 'true' }, invoice_history: { enabled: params['features[invoice_history][enabled]'] === 'true' },
          payment_method_update: { enabled: params['features[payment_method_update][enabled]'] === 'true' }, subscription_cancel: { enabled: params['features[subscription_cancel][enabled]'] === 'true', mode: params['features[subscription_cancel][mode]'] },
          subscription_update: { enabled: params['features[subscription_update][enabled]'] === 'true' },
        } };
        portalConfigs.set(id, configuration); return response(configuration);
      }
      if (pathname.startsWith('/billing_portal/configurations/')) return response(portalConfigs.get(pathname.split('/')[3]));
      if (pathname === '/billing_portal/sessions') return response({ url: 'https://billing.stripe.com/p/session/fixture', customer: params.customer, configuration: params.configuration });
      throw new Error('Unexpected Stripe path ' + pathname);
    }
    assert.ok(['openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com'].includes(target.hostname));
    assert.ok(createVerify('RSA-SHA256').update(alipayCanonical(params, false)).verify(appKeys.publicKey, params.sign, 'base64'), 'real outgoing Alipay request signature');
    if (params.method === 'alipay.trade.query' && pausedAlipay) { alipayPauseEntered?.(); await pausedAlipay; pausedAlipay = null; }
    const biz = JSON.parse(params.biz_content), trade = alipayTrades.get(biz.out_trade_no);
    let result;
    if (params.method === 'alipay.trade.query') result = trade ? { code: '10000', ...trade } : { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' };
    else if (params.method === 'alipay.trade.close') { if (trade) { trade.trade_status = 'TRADE_CLOSED'; result = { code: '10000' }; } else result = { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' }; }
    else throw new Error('Unexpected Alipay method.');
    const raw = JSON.stringify(result), property = params.method.replaceAll('.', '_') + '_response';
    const sign = unsignedAlipay ? 'invalid' : createSign('RSA-SHA256').update(raw).sign(pair.privateKey, 'base64');
    return new Response(`{ "${property}" : ${raw}, "sign":${JSON.stringify(sign)} }`);
  }
  const billing = createBilling({ db, env, fetch: fetcher, clock: () => time });
  t.after(() => { billing.close(); if (!overrides.db) db.close(); });
  async function checkout(provider = 'stripe', planId = 'pro', interval = 'monthly', key = randomUUID()) { return billing.checkout(user, { provider, planId, interval }, key); }
  function paidStripe(order, suffix = 'first', startsAt = time, endsAt = time + 30 * 86400000) {
    const saved = billing.ledger.ownedOrder(order.id, user.id), session = sessions.get(saved.session_id), subId = session.subscription || 'sub_fixture' + sessions.size;
    session.subscription = subId; session.status = 'complete'; session.payment_status = 'paid';
    const invoiceId = 'in_' + suffix;
    subscriptions.set(subId, { id: subId, customer: session.customer, status: 'active', cancel_at_period_end: false, current_period_start: Math.floor(startsAt / 1000), current_period_end: Math.floor(endsAt / 1000), metadata: { gamestudio_order_id: order.id, gamestudio_user_id: user.id }, items: { data: [{ quantity: 1, price: { id: saved.price_id } }] }, latest_invoice: invoiceId });
    invoices.set(invoiceId, { id: invoiceId, subscription: subId, customer: session.customer, status: 'paid', paid: true, paid_out_of_band: false, amount_paid: saved.amount, amount_due: saved.amount, currency: saved.currency, lines: { data: [{ price: { id: saved.price_id }, quantity: 1, proration: false, period: { start: Math.floor(startsAt / 1000), end: Math.floor(endsAt / 1000) } }], has_more: false }, status_transitions: { paid_at: Math.floor(time / 1000) }, hosted_invoice_url: 'https://invoice.stripe.com/i/' + invoiceId });
    charges.set('ch_' + suffix, { id: 'ch_' + suffix, invoice: invoiceId, customer: session.customer, amount: saved.amount, amount_refunded: 0, currency: saved.currency });
    return { subId, invoiceId, chargeId: 'ch_' + suffix };
  }
  function event(type, id, eventId = 'evt_' + (++count)) {
    const raw = Buffer.from(JSON.stringify({ id: eventId, type, created: Math.floor(time / 1000), data: { object: { id } } }));
    const timestamp = Math.floor(time / 1000), sign = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.').update(raw).digest('hex');
    return billing.stripeWebhook(raw, `t=${timestamp},v1=${sign}`);
  }
  function unpaidStripe(order, status = 'requires_action') {
    const payment = paidStripe(order), invoice = invoices.get(payment.invoiceId), sub = subscriptions.get(payment.subId), intentId = 'pi_' + (++count);
    invoice.status = 'open'; invoice.paid = false; invoice.amount_paid = 0; invoice.payment_intent = intentId; sub.status = 'incomplete';
    sessions.get(billing.ledger.ownedOrder(order.id, user.id).session_id).payment_status = 'unpaid';
    intents.set(intentId, { id: intentId, customer: sub.customer, invoice: invoice.id, amount: order.amount, currency: order.currency, amount_received: 0, status });
    return { ...payment, intentId };
  }
  function alipayNotify(order, changes = {}) {
    const saved = billing.ledger.ownedOrder(order.id, user.id);
    const params = { app_id: env.ALIPAY_APP_ID, seller_id: env.ALIPAY_SELLER_ID, sign_type: 'RSA2', out_trade_no: saved.merchant_order_id, trade_no: 'trade' + order.id.replaceAll('-', ''), total_amount: (order.amount / 100).toFixed(2), trade_status: 'TRADE_SUCCESS', notify_id: 'notify' + (++count), ...changes };
    params.sign = createSign('RSA-SHA256').update(alipayCanonical(params)).sign(pair.privateKey, 'base64'); return params;
  }
  function paidAlipay(order) { const params = alipayNotify(order); alipayTrades.set(params.out_trade_no, { out_trade_no: params.out_trade_no, trade_no: params.trade_no, total_amount: params.total_amount, trade_status: 'TRADE_SUCCESS', seller_id: env.ALIPAY_SELLER_ID }); return params; }
  return { billing, db, env, requests, checkout, paidStripe, unpaidStripe, event, sessions, subscriptions, invoices, intents, voidRaces, expireRaces, charges, disputes, alipayTrades, portalConfigs, alipayNotify, paidAlipay,
    time: () => time, advance: ms => { time += ms; }, unsigned: value => { unsignedAlipay = value; },
    failCheckout: () => { failCheckout = true; }, pauseCheckout: () => { let release; pausedCheckout = new Promise(resolve => { release = resolve; }); return { entered: new Promise(resolve => { pauseEntered = resolve; }), release }; },
    pauseAlipay: () => { let release; pausedAlipay = new Promise(resolve => { release = resolve; }); return { entered: new Promise(resolve => { alipayPauseEntered = resolve; }), release }; } };
}

test('unconfigured providers fail explicitly, never synthesize checkout or membership', async t => {
  const s = setup(t, { env: { STRIPE_SECRET_KEY: '', ALIPAY_APP_ID: '' } });
  assert.equal(s.billing.membership(user.id).planId, 'free');
  await assert.rejects(s.checkout(), { status: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  await assert.rejects(s.checkout('alipay'), { status: 503 });
  assert.equal(s.billing.ledger.orders(user.id).length, 0);
  const plans = await s.billing.plans(); assert.equal(plans.providers.stripe.available, false); assert.equal(plans.providers.alipay.available, false);
});

test('Stripe checkout uses real fixed-price REST payload and durable idempotency without granting redirect access', async t => {
  const s = setup(t), key = randomUUID(), order = await s.checkout('stripe', 'pro', 'monthly', key);
  assert.equal(order.amount, 1900); assert.match(order.checkoutUrl, /^https:\/\/checkout.stripe.com\//);
  assert.equal(s.billing.membership(user.id).planId, 'free');
  assert.equal((await s.checkout('stripe', 'pro', 'monthly', key)).id, order.id);
  assert.equal(s.requests.filter(r => new URL(r.url).pathname === '/v1/checkout/sessions').length, 1);
  const request = s.requests.find(r => new URL(r.url).pathname === '/v1/checkout/sessions');
  assert.equal(request.params.mode, 'subscription'); assert.equal(request.params['subscription_data[metadata][gamestudio_user_id]'], user.id);
  assert.equal(request.params['line_items[0][price]'], 'price_proMonthly');
  await assert.rejects(s.checkout('stripe', 'studio', 'monthly', key), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(s.checkout('stripe'), { code: 'PENDING_CHECKOUT_EXISTS' });
});

test('Stripe validates HMAC against exact raw body, rotated signatures and five-minute timestamp window', () => {
  const now = Date.now(), timestamp = Math.floor(now / 1000), raw = Buffer.from('{ "test": 1 }');
  const signature = createHmac('sha256', 'secret').update(timestamp + '.').update(raw).digest('hex');
  assert.deepEqual(verifyStripeSignature(raw, `t=${timestamp},v1=${'a'.repeat(64)},v1=${signature}`, 'secret', now), { test: 1 });
  assert.throws(() => verifyStripeSignature(Buffer.from('{"test":1}'), `t=${timestamp},v1=${signature}`, 'secret', now), { code: 'INVALID_PAYMENT_SIGNATURE' });
  assert.throws(() => verifyStripeSignature(raw, `t=${timestamp},v1=${signature}`, 'secret', now + 301000), { code: 'INVALID_PAYMENT_SIGNATURE' });
  assert.throws(() => verifyStripeSignature(raw, `t=${timestamp},t=${timestamp},v1=${signature}`, 'secret', now), { code: 'INVALID_PAYMENT_SIGNATURE' });
});

test('authoritative paid invoice grants once; duplicate notifications and old snapshots cannot grant extra time', async t => {
  const s = setup(t), order = await s.checkout(), payment = s.paidStripe(order);
  const first = await s.event('invoice.paid', payment.invoiceId, 'evt_once'); assert.equal(first.received, true);
  assert.equal(s.billing.membership(user.id).planId, 'pro'); assert.equal(s.billing.ledger.history(user.id).length, 1);
  assert.equal((await s.event('invoice.paid', payment.invoiceId, 'evt_once')).duplicate, true);
  await s.event('invoice.payment_failed', payment.invoiceId); // Late snapshot is re-fetched as paid.
  assert.equal(s.billing.ledger.history(user.id).length, 1);
  assert.equal(s.billing.ledger.publicOrder(s.billing.ledger.ownedOrder(order.id, user.id)).status, 'paid');
  await assert.rejects(s.checkout('stripe'), { code: 'ACTIVE_SUBSCRIPTION_EXISTS' });
});

test('mismatched amount, customer, price, offline-marked invoice and forged subscription metadata fail atomically', async t => {
  const s = setup(t), order = await s.checkout(), payment = s.paidStripe(order), invoice = s.invoices.get(payment.invoiceId), sub = s.subscriptions.get(payment.subId);
  invoice.amount_paid = 1; await assert.rejects(s.event('invoice.paid', payment.invoiceId), { code: 'PAYMENT_AMOUNT_MISMATCH' }); invoice.amount_paid = order.amount;
  invoice.customer = 'cus_foreign'; await assert.rejects(s.event('invoice.paid', payment.invoiceId), { code: 'PAYMENT_IDENTITY_MISMATCH' }); invoice.customer = sub.customer;
  sub.items.data[0].price.id = 'price_foreign'; await assert.rejects(s.event('invoice.paid', payment.invoiceId), { code: 'PAYMENT_PLAN_MISMATCH' }); sub.items.data[0].price.id = 'price_proMonthly';
  invoice.paid_out_of_band = true; await assert.rejects(s.event('invoice.paid', payment.invoiceId), { code: 'PAYMENT_AMOUNT_MISMATCH' }); invoice.paid_out_of_band = false;
  sub.metadata.gamestudio_user_id = 'user_mallory'; await assert.rejects(s.event('invoice.paid', payment.invoiceId), { code: 'PAYMENT_IDENTITY_MISMATCH' });
  assert.equal(s.billing.ledger.history(user.id).length, 0); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('unpaid subscription never grants; renewal extends only its settled invoice and expiry removes access', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order);
  s.invoices.get(paid.invoiceId).status = 'open'; s.invoices.get(paid.invoiceId).paid = false;
  await s.event('customer.subscription.updated', paid.subId); assert.equal(s.billing.membership(user.id).planId, 'free');
  s.invoices.get(paid.invoiceId).status = 'paid'; s.invoices.get(paid.invoiceId).paid = true;
  await s.event('invoice.paid', paid.invoiceId);
  s.advance(30 * 86400000); assert.equal(s.billing.membership(user.id).planId, 'free');
  const renewed = s.paidStripe(order, 'renewal'); await s.event('invoice.paid', renewed.invoiceId);
  assert.equal(s.billing.membership(user.id).planId, 'pro'); assert.equal(s.billing.ledger.history(user.id).length, 2);
});

test('cancel-at-period-end preserves paid access; immediate cancellation and late prior events cannot revive it', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId);
  await s.billing.cancel(user.id, order.id); assert.equal(s.billing.membership(user.id).cancelAtPeriodEnd, true); assert.equal(s.billing.membership(user.id).planId, 'pro');
  s.subscriptions.get(paid.subId).status = 'canceled'; await s.event('customer.subscription.deleted', paid.subId);
  assert.equal(s.billing.membership(user.id).planId, 'free');
  await s.event('invoice.paid', paid.invoiceId); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('full refund preceding paid notification stays revoked; partial refunds retain access and are durable', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order), charge = s.charges.get(paid.chargeId);
  charge.amount_refunded = 500; await s.event('charge.refunded', paid.chargeId); await s.event('invoice.paid', paid.invoiceId);
  assert.equal(s.billing.membership(user.id).planId, 'pro');
  charge.amount_refunded = order.amount; await s.event('charge.refunded', paid.chargeId); await s.event('invoice.paid', paid.invoiceId);
  assert.equal(s.billing.membership(user.id).planId, 'free'); assert.equal(s.billing.ledger.history(user.id)[0].status, 'refunded');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM billing_refunds').get().n, 2);
});

test('refund delivered before its invoice creates a tombstone that prevents out-of-order activation', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order);
  s.charges.get(paid.chargeId).amount_refunded = order.amount;
  await s.event('charge.refunded', paid.chargeId); await s.event('invoice.paid', paid.invoiceId);
  assert.equal(s.billing.ledger.history(user.id)[0].status, 'refunded'); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('verified disputes suspend their invoice; won dispute restores only unrefunded original access', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId);
  const dispute = { id: 'dp_fixture', charge: paid.chargeId, status: 'needs_response', amount: order.amount }; s.disputes.set(dispute.id, dispute);
  await s.event('charge.dispute.created', dispute.id); assert.equal(s.billing.membership(user.id).planId, 'free');
  dispute.status = 'won'; await s.event('charge.dispute.closed', dispute.id); assert.equal(s.billing.membership(user.id).planId, 'pro');
  s.charges.get(paid.chargeId).amount_refunded = order.amount; await s.event('charge.refunded', paid.chargeId);
  await s.event('charge.dispute.closed', dispute.id); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('verified disputes ending warning_closed or prevented restore legitimate access but never override a refund', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId);
  for (const terminal of ['warning_closed', 'prevented']) {
    const dispute = { id: 'dp_' + terminal.replaceAll('_', ''), charge: paid.chargeId, status: 'warning_needs_response', amount: order.amount };
    s.disputes.set(dispute.id, dispute); await s.event('charge.dispute.created', dispute.id); assert.equal(s.billing.membership(user.id).planId, 'free');
    dispute.status = terminal; await s.event('charge.dispute.closed', dispute.id); assert.equal(s.billing.membership(user.id).planId, 'pro');
  }
  s.charges.get(paid.chargeId).amount_refunded = order.amount; await s.event('charge.refunded', paid.chargeId);
  await s.event('charge.dispute.closed', 'dp_prevented'); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('Alipay unopened checkout cancels after verified TRADE_NOT_EXIST and its signed URL has an immutable absolute deadline', async t => {
  const s = setup(t), order = await s.checkout('alipay'), originalUrl = order.checkoutUrl;
  const biz = JSON.parse(new URL(originalUrl).searchParams.get('biz_content'));
  assert.equal(biz.time_expire, alipayTimestamp(s.time() + 15 * 60000)); assert.equal(biz.timeout_express, undefined);
  assert.equal(new Date(order.expiresAt).getTime(), s.time() + 15 * 60000);
  assert.equal((await s.billing.cancel(user.id, order.id)).status, 'canceled');
  const retry = await s.checkout('alipay', 'pro', 'monthly', s.billing.ledger.ownedOrder(order.id, user.id).idempotency_key);
  assert.equal(retry.checkoutUrl, null); assert.equal(retry.status, 'canceled');
  s.advance(16 * 60000); assert.equal(JSON.parse(new URL(originalUrl).searchParams.get('biz_content')).time_expire, biz.time_expire, 'opening an old signed link cannot reset its gateway expiry');
});

test('Alipay page, query, close and signed callbacks use the same immutable merchant reference while public API keeps UUIDs', async t => {
  const s = setup(t), order = await s.checkout('alipay'), saved = s.billing.ledger.ownedOrder(order.id, user.id);
  assert.match(order.id, /^[a-f0-9]{8}-[a-f0-9-]{27}$/); assert.match(saved.merchant_order_id, /^gs_[a-f0-9]{32}$/);
  assert.equal(JSON.parse(new URL(order.checkoutUrl).searchParams.get('biz_content')).out_trade_no, saved.merchant_order_id);
  const wrong = s.alipayNotify(order, { out_trade_no: order.id });
  await assert.rejects(s.billing.alipayWebhook(wrong), { code: 'ORDER_NOT_FOUND' });
  const notification = s.paidAlipay(order); await s.billing.alipayWebhook(notification); assert.equal(s.billing.membership(user.id).planId, 'pro');
  const query = s.requests.find(request => request.params.method === 'alipay.trade.query'); assert.equal(JSON.parse(query.params.biz_content).out_trade_no, saved.merchant_order_id);
  const renewal = await s.checkout('alipay'), renewed = s.billing.ledger.ownedOrder(renewal.id, user.id);
  await s.billing.cancel(user.id, renewal.id);
  const close = s.requests.find(request => request.params.method === 'alipay.trade.close'); assert.equal(JSON.parse(close.params.biz_content).out_trade_no, renewed.merchant_order_id);
  assert.throws(() => s.db.prepare('UPDATE billing_orders SET merchant_order_id=? WHERE id=?').run('gs_changed', order.id), /immutable/);
  assert.throws(() => s.db.prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan_id,interval,amount,currency,merchant_order_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'other', 'unique-key', 'alipay', 'pro', 'monthly', 12900, 'cny', saved.merchant_order_id, s.time(), s.time() + 1000), /UNIQUE/);
});

test('Alipay merchant reference migration retains published legacy identifiers and fixes unpublished orders idempotently', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE billing_orders (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,provider TEXT NOT NULL,
    plan_id TEXT NOT NULL,interval TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,
    price_id TEXT,status TEXT NOT NULL DEFAULT 'pending',checkout_url TEXT,session_id TEXT UNIQUE,
    subscription_id TEXT,trade_id TEXT UNIQUE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    paid_at INTEGER,last_synced_at INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,idempotency_key));`);
  const publishedId = randomUUID(), unpublishedId = randomUUID(), now = Date.UTC(2026, 0, 31, 12);
  const insert = db.prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan_id,interval,amount,currency,checkout_url,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run(publishedId, user.id, 'legacy-published', 'alipay', 'pro', 'monthly', 12900, 'cny', 'https://openapi.alipay.com/gateway.do?legacy', now, now + 3600000);
  insert.run(unpublishedId, user.id, 'legacy-unpublished', 'alipay', 'pro', 'monthly', 12900, 'cny', null, now, now + 3600000);
  const s = setup(t, { db }), published = s.billing.ledger.ownedOrder(publishedId, user.id), unpublished = s.billing.ledger.ownedOrder(unpublishedId, user.id);
  assert.equal(published.merchant_order_id, publishedId, 'an already-issued legacy gateway reference must not be renamed');
  assert.equal(unpublished.merchant_order_id, 'gs_' + unpublishedId.replaceAll('-', ''));
  const order = s.billing.ledger.publicOrder(published); await s.billing.alipayWebhook(s.paidAlipay(order));
  assert.equal(s.billing.membership(user.id).planId, 'pro');
  assert.equal(JSON.parse(s.requests.find(request => request.params.method === 'alipay.trade.query').params.biz_content).out_trade_no, publishedId);
  const reopened = createBilling({ db, env: s.env, clock: s.time });
  assert.equal(reopened.ledger.ownedOrder(publishedId, user.id).merchant_order_id, publishedId); assert.equal(reopened.ledger.ownedOrder(unpublishedId, user.id).merchant_order_id, unpublished.merchant_order_id);
  await reopened.close();
});

test('Stripe failed checkout retry preserves its durable original price snapshot after environment price change', async t => {
  const s = setup(t), key = randomUUID(); s.failCheckout();
  await assert.rejects(s.checkout('stripe', 'pro', 'monthly', key), { code: 'PAYMENT_PROVIDER_ERROR' });
  const before = s.billing.ledger.orders(user.id)[0]; assert.equal(before.checkoutUrl, null);
  s.billing.config.plans.find(plan => plan.id === 'pro').stripe.monthly = 'price_replacement';
  const retry = await s.checkout('stripe', 'pro', 'monthly', key); assert.equal(retry.id, before.id); assert.equal(retry.amount, 1900); assert.equal(retry.currency, 'usd');
  const sessions = s.requests.filter(request => new URL(request.url).pathname === '/v1/checkout/sessions');
  assert.deepEqual(sessions.map(request => request.params['line_items[0][price]']), ['price_proMonthly', 'price_proMonthly']);
  const paid = s.paidStripe(retry); await s.event('invoice.paid', paid.invoiceId); assert.equal(s.billing.membership(user.id).planId, 'pro');
});

test('billing shutdown aborts provider work and late responses cannot access an already closed SQLite database', async t => {
  const db = new DatabaseSync(':memory:'), s = setup(t, { db }), pause = s.pauseCheckout();
  const pending = s.checkout(); await pause.entered;
  const closing = s.billing.close(); db.close(); pause.release();
  await assert.rejects(pending, { code: 'BILLING_CLOSED' }); await closing;
  await assert.rejects(s.billing.plans(), { code: 'BILLING_CLOSED' });
  assert.throws(() => s.billing.reserveUsage(user.id, 'late'), { code: 'BILLING_CLOSED' });
  assert.equal(s.requests.at(-1).options.signal.aborted, true);
});

test('billing reconciliation limits batches and yields the provider lock to waiting webhooks between orders', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId);
  for (let i = 0; i < 8; i++) s.billing.ledger.createOrder({ userId: 'background' + i, key: randomUUID(), provider: 'alipay', planId: 'pro', interval: 'monthly', amount: 12900, currency: 'cny' });
  const pause = s.pauseAlipay(), start = s.requests.length, reconciliation = s.billing.reconcileActive(); await pause.entered;
  const webhook = s.event('invoice.paid', paid.invoiceId); pause.release();
  await Promise.all([reconciliation, webhook]);
  const requests = s.requests.slice(start), alipayIndexes = requests.flatMap((request, index) => request.params.method === 'alipay.trade.query' ? [index] : []);
  assert.equal(alipayIndexes.length, 5, 'large backlogs are bounded to five orders per pass');
  const invoiceIndex = requests.findIndex(request => new URL(request.url).pathname === '/v1/invoices/' + paid.invoiceId);
  assert.ok(invoiceIndex > alipayIndexes[0] && invoiceIndex < alipayIndexes[1], 'waiting webhook runs after first background order and before the second');
});

test('Alipay checkout is genuinely signed RSA2, grants only after signed provider query, and duplicate notifications do not extend', async t => {
  const s = setup(t), order = await s.checkout('alipay'), params = Object.fromEntries(new URL(order.checkoutUrl).searchParams);
  assert.equal(params.method, 'alipay.trade.page.pay'); assert.equal(JSON.parse(params.biz_content).total_amount, '129.00');
  assert.ok(createVerify('RSA-SHA256').update(alipayCanonical(params, false)).verify(appKeys.publicKey, params.sign, 'base64'));
  assert.equal(s.billing.membership(user.id).planId, 'free');
  const notification = s.paidAlipay(order); await s.billing.alipayWebhook(notification);
  const first = s.billing.membership(user.id); assert.equal(first.planId, 'pro'); assert.equal(first.expiresAt, '2026-02-28T12:00:00.000Z');
  await s.billing.alipayWebhook(notification); await s.billing.alipayWebhook(s.alipayNotify(order));
  assert.equal(s.billing.membership(user.id).expiresAt, first.expiresAt); assert.equal(s.billing.ledger.history(user.id).length, 1);
});

test('Alipay rejects forged callback, wrong seller/application, duplicate parameter arrays, amount mismatch and unsigned server query', async t => {
  const s = setup(t), order = await s.checkout('alipay'), good = s.paidAlipay(order);
  await assert.rejects(s.billing.alipayWebhook({ ...good, sign: 'forged' }), { code: 'INVALID_PAYMENT_SIGNATURE' });
  await assert.rejects(s.billing.alipayWebhook(s.alipayNotify(order, { seller_id: 'foreign' })), { code: 'PAYMENT_IDENTITY_MISMATCH' });
  await assert.rejects(s.billing.alipayWebhook(s.alipayNotify(order, { app_id: 'foreign' })), { code: 'PAYMENT_IDENTITY_MISMATCH' });
  await assert.rejects(s.billing.alipayWebhook({ ...good, total_amount: ['129.00', '0.01'] }), { code: 'INVALID_PAYMENT_SIGNATURE' });
  await assert.rejects(s.billing.alipayWebhook(s.alipayNotify(order, { total_amount: '0.01' })), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  s.unsigned(true); await assert.rejects(s.billing.alipayWebhook(good), { code: 'INVALID_PROVIDER_SIGNATURE' });
  assert.equal(s.billing.membership(user.id).planId, 'free'); assert.equal(s.billing.ledger.history(user.id).length, 0);
});

test('Alipay callback cannot override waiting provider state; same-plan prepaid renewal stacks and queried refund revokes', async t => {
  const s = setup(t), order = await s.checkout('alipay'), notification = s.paidAlipay(order), trade = s.alipayTrades.get(notification.out_trade_no);
  trade.trade_status = 'WAIT_BUYER_PAY'; await s.billing.alipayWebhook(notification); assert.equal(s.billing.membership(user.id).planId, 'free');
  trade.trade_status = 'TRADE_SUCCESS'; await s.billing.alipayWebhook(s.alipayNotify(order));
  const renewal = await s.checkout('alipay'), renewalNotification = s.paidAlipay(renewal); await s.billing.alipayWebhook(renewalNotification);
  const history = s.billing.ledger.history(user.id); assert.equal(history.length, 2); assert.equal(history.find(p => p.orderId === renewal.id).startsAt, history.find(p => p.orderId === order.id).expiresAt);
  await assert.rejects(s.checkout('stripe'), { code: 'ACTIVE_MEMBERSHIP_EXISTS' });
  trade.trade_status = 'TRADE_CLOSED'; s.advance(6000); await s.billing.refreshOrder(user.id, order.id);
  assert.equal(s.billing.ledger.history(user.id).find(p => p.orderId === order.id).status, 'refunded');
  assert.equal(s.billing.membership(user.id).planId, 'free', 'future prepaid renewal is not granted early after original payment refunded');
});

test('Alipay partial refund totals come from signed refund_fee notifications and cannot be forged or exceed the order', async t => {
  const s = setup(t), order = await s.checkout('alipay'); await s.billing.alipayWebhook(s.paidAlipay(order));
  await s.billing.alipayWebhook(s.alipayNotify(order, { refund_fee: '10.00' }));
  assert.equal(s.billing.membership(user.id).planId, 'pro');
  assert.equal(s.db.prepare("SELECT amount FROM billing_refunds WHERE reason='partial_refund'").get().amount, 1000);
  await assert.rejects(s.billing.alipayWebhook(s.alipayNotify(order, { refund_fee: '1000.00' })), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  const forged = s.alipayNotify(order, { refund_fee: '10.00' }); forged.refund_fee = '129.00';
  await assert.rejects(s.billing.alipayWebhook(forged), { code: 'INVALID_PAYMENT_SIGNATURE' });
  await s.billing.alipayWebhook(s.alipayNotify(order, { refund_fee: '129.00' })); assert.equal(s.billing.membership(user.id).planId, 'free');
});

test('ownership isolates payment history/order polling and customer portal cannot use foreign IDs', async t => {
  const s = setup(t), order = await s.checkout();
  await assert.rejects(s.billing.refreshOrder('user_mallory', order.id), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(s.billing.cancel('user_mallory', order.id), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(s.billing.portal('user_mallory'), { code: 'BILLING_CUSTOMER_NOT_FOUND' });
  assert.deepEqual(s.billing.ledger.history('user_mallory'), []); assert.equal((await s.billing.portal(user.id)).url, 'https://billing.stripe.com/p/session/fixture');
});

test('Stripe portal uses a dedicated safe configuration and persists its fingerprint without mutating merchant defaults', async t => {
  const s = setup(t); await s.checkout();
  await Promise.all([s.billing.portal(user.id), s.billing.portal(user.id)]);
  const created = s.requests.filter(request => new URL(request.url).pathname === '/v1/billing_portal/configurations'); assert.equal(created.length, 1);
  const request = created[0]; assert.equal(request.options.method, 'POST'); assert.equal(request.params['features[subscription_update][enabled]'], 'false');
  assert.equal(request.params['features[subscription_cancel][enabled]'], 'true'); assert.equal(request.params['features[subscription_cancel][mode]'], 'at_period_end');
  assert.equal(request.params['features[invoice_history][enabled]'], 'true'); assert.equal(request.params['features[payment_method_update][enabled]'], 'true'); assert.equal(request.params['features[customer_update][enabled]'], 'true');
  const stored = s.db.prepare('SELECT * FROM billing_provider_settings').all(); assert.equal(stored.length, 1); assert.match(stored[0].key, /^stripe:portal:[a-f0-9]{64}$/); assert.ok(!JSON.stringify(stored).includes(s.env.STRIPE_SECRET_KEY));
  const sessions = s.requests.filter(item => new URL(item.url).pathname === '/v1/billing_portal/sessions'); assert.equal(sessions.length, 2); assert.ok(sessions.every(item => item.params.configuration === stored[0].value));
  const reopened = createBilling({ db: s.db, env: s.env, clock: s.time, fetch: async (url, options) => {
    if (url.endsWith('/billing_portal/configurations/' + stored[0].value)) return new Response(JSON.stringify(s.portalConfigs.get(stored[0].value)));
    if (url.endsWith('/billing_portal/sessions')) { const body = new URLSearchParams(options.body); assert.equal(body.get('configuration'), stored[0].value); return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/reopened', configuration: body.get('configuration'), customer: body.get('customer') })); }
    throw new Error('Restart must reuse its app-specific configuration rather than create or mutate another.');
  } });
  await reopened.portal(user.id); await reopened.close();
});

test('Stripe explicit portal configuration is revalidated; unsafe changes or immediate cancellation are rejected', async t => {
  const s = setup(t, { env: { STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_custom' } }); await s.checkout();
  const configuration = { id: 'bpc_custom', active: true, is_default: true, features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end' } } }; s.portalConfigs.set(configuration.id, configuration);
  await assert.rejects(s.billing.portal(user.id), { code: 'UNSAFE_PORTAL_CONFIGURATION' });
  assert.equal(s.requests.filter(request => new URL(request.url).pathname === '/v1/billing_portal/sessions').length, 0);
  configuration.features.subscription_update.enabled = false; configuration.features.subscription_cancel.mode = 'immediately';
  await assert.rejects(s.billing.portal(user.id), { code: 'UNSAFE_PORTAL_CONFIGURATION' });
  configuration.features.subscription_cancel.mode = 'at_period_end'; await s.billing.portal(user.id);
  configuration.active = false; await assert.rejects(s.billing.portal(user.id), { code: 'UNSAFE_PORTAL_CONFIGURATION' });
  assert.equal(s.requests.filter(request => new URL(request.url).pathname === '/v1/billing_portal/configurations' && request.options.method === 'POST').length, 0, 'never mutates an explicit/default merchant configuration');
});

test('cached app portal config cannot enable unsupported plan changes, and direct renewal cancellation still works', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId); await s.billing.portal(user.id);
  const configuration = [...s.portalConfigs.values()][0]; configuration.features.subscription_update.enabled = true;
  await assert.rejects(s.billing.portal(user.id), { code: 'UNSAFE_PORTAL_CONFIGURATION' });
  const owned = s.billing.ledger.orders(user.id).find(value => value.id === order.id); assert.equal(owned.subscriptionId, paid.subId); assert.equal(owned.subscriptionStatus, 'active');
  const canceled = await s.billing.cancel(user.id, owned.id); assert.equal(canceled.cancelAtPeriodEnd, true); assert.equal(s.billing.membership(user.id).planId, 'pro'); assert.equal(s.billing.membership(user.id).cancelAtPeriodEnd, true);
});

test('canceling renewal again after provider reactivation uses a fresh action key and preserves paid access', async t => {
  const s = setup(t), order = await s.checkout(), paid = s.paidStripe(order); await s.event('invoice.paid', paid.invoiceId);
  await s.billing.cancel(user.id, order.id); s.subscriptions.get(paid.subId).cancel_at_period_end = false;
  await s.event('customer.subscription.updated', paid.subId); assert.equal(s.billing.membership(user.id).cancelAtPeriodEnd, false);
  await s.billing.cancel(user.id, order.id); assert.equal(s.billing.membership(user.id).cancelAtPeriodEnd, true); assert.equal(s.billing.membership(user.id).planId, 'pro');
  const requests = s.requests.filter(request => request.options.method === 'POST' && new URL(request.url).pathname === '/v1/subscriptions/' + paid.subId);
  assert.equal(requests.length, 2); assert.notEqual(requests[0].options.headers['Idempotency-Key'], requests[1].options.headers['Idempotency-Key']);
});

test('Stripe completed unpaid Checkout cancels invoice-owned intents and incomplete subscriptions without charging or losing paid access', async t => {
  for (const status of ['requires_action', 'requires_payment_method', 'requires_confirmation', 'requires_capture']) {
    const s = setup(t), order = await s.checkout(), payment = s.unpaidStripe(order, status);
    const canceled = await s.billing.cancel(user.id, order.id);
    assert.equal(canceled.status, 'canceled'); assert.equal(canceled.subscriptionStatus, 'canceled'); assert.equal(s.invoices.get(payment.invoiceId).status, 'void'); assert.equal(s.intents.get(payment.intentId).status, 'canceled');
    assert.equal(s.billing.membership(user.id).planId, 'free'); assert.equal(s.billing.ledger.history(user.id).length, 0);
    assert.equal(s.requests.filter(request => new URL(request.url).pathname.endsWith('/expire')).length, 0, 'cannot expire a completed Checkout');
    assert.equal(s.requests.filter(request => new URL(request.url).pathname.includes('/payment_intents/') && request.options.method !== 'GET').length, 0, 'invoice-owned intent cancellation goes through invoice voiding');
    const deletion = s.requests.find(request => request.options.method === 'DELETE'); assert.equal(deletion.params.invoice_now, 'false'); assert.equal(deletion.params.prorate, 'false');
    assert.equal((await s.billing.cancel(user.id, order.id)).status, 'canceled', 'confirmed cancellation is idempotent');
    const next = await s.checkout(); assert.notEqual(next.id, order.id, 'canceled incomplete subscription no longer prevents another checkout');
  }
});

test('Stripe payment processing and succeeded-but-unsettled invoices return 409 without financial cancellation mutations', async t => {
  for (const status of ['processing', 'succeeded']) {
    const s = setup(t), order = await s.checkout(), payment = s.unpaidStripe(order, status);
    if (status === 'succeeded') s.intents.get(payment.intentId).amount_received = order.amount;
    const before = s.requests.length; await assert.rejects(s.billing.cancel(user.id, order.id), { status: 409, code: 'PAYMENT_PROCESSING' });
    assert.equal(s.billing.ledger.ownedOrder(order.id, user.id).status, 'pending'); assert.equal(s.subscriptions.get(payment.subId).status, 'incomplete');
    assert.ok(s.requests.slice(before).every(request => request.options.method === 'GET')); assert.equal(s.billing.ledger.history(user.id).length, 0);
  }
});

test('Stripe draft invoices wait without cancellation, and automatically expired unpaid subscriptions close without another charge', async t => {
  const first = setup(t), pending = await first.checkout(), state = first.unpaidStripe(pending), invoice = first.invoices.get(state.invoiceId);
  invoice.status = 'draft'; invoice.amount_due = 0; const start = first.requests.length;
  await assert.rejects(first.billing.cancel(user.id, pending.id), { status: 409, code: 'PAYMENT_PROCESSING' }); assert.ok(first.requests.slice(start).every(request => request.options.method === 'GET'));
  invoice.status = 'void'; first.intents.get(state.intentId).status = 'canceled'; first.subscriptions.get(state.subId).status = 'incomplete_expired';
  const result = await first.billing.cancel(user.id, pending.id); assert.equal(result.status, 'canceled'); assert.equal(result.subscriptionStatus, 'incomplete_expired'); assert.equal(first.billing.membership(user.id).planId, 'free');
  assert.ok(first.requests.slice(start).every(request => request.options.method === 'GET'), 'an already terminal provider state needs no second cancellation mutation');
});

test('Stripe pending cancellation checks invoice and intent ownership/amount before any irreversible operation', async t => {
  const s = setup(t), order = await s.checkout(), payment = s.unpaidStripe(order), intent = s.intents.get(payment.intentId), before = s.requests.length;
  intent.customer = 'cus_foreign'; await assert.rejects(s.billing.cancel(user.id, order.id), { code: 'PAYMENT_IDENTITY_MISMATCH' });
  intent.customer = s.subscriptions.get(payment.subId).customer; intent.amount = 1; await assert.rejects(s.billing.cancel(user.id, order.id), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  assert.ok(s.requests.slice(before).every(request => request.options.method === 'GET')); assert.equal(s.invoices.get(payment.invoiceId).status, 'open');
});

test('Stripe invoice paid race refreshes authoritative resources and cancels renewal while preserving the newly paid membership', async t => {
  const s = setup(t), order = await s.checkout(), payment = s.unpaidStripe(order);
  s.voidRaces.set(payment.invoiceId, () => { const invoice = s.invoices.get(payment.invoiceId), intent = s.intents.get(payment.intentId); invoice.status = 'paid'; invoice.paid = true; invoice.amount_paid = order.amount; s.subscriptions.get(payment.subId).status = 'active'; intent.status = 'succeeded'; intent.amount_received = order.amount; });
  const canceled = await s.billing.cancel(user.id, order.id);
  assert.equal(canceled.status, 'paid'); assert.equal(canceled.cancelAtPeriodEnd, true); assert.equal(s.billing.membership(user.id).planId, 'pro');
  assert.equal(s.billing.ledger.history(user.id).length, 1); assert.equal(s.subscriptions.get(payment.subId).status, 'active'); assert.equal(s.requests.filter(request => request.options.method === 'DELETE').length, 0);
});

test('Stripe already paid pending Checkout is credited and renewal-canceled instead of expiring its completed session', async t => {
  const s = setup(t), order = await s.checkout(), payment = s.paidStripe(order);
  assert.equal(s.billing.ledger.ownedOrder(order.id, user.id).status, 'pending');
  const result = await s.billing.cancel(user.id, order.id); assert.equal(result.status, 'paid'); assert.equal(result.cancelAtPeriodEnd, true);
  assert.equal(s.billing.membership(user.id).planId, 'pro'); assert.equal(s.invoices.get(payment.invoiceId).status, 'paid');
  assert.equal(s.requests.filter(request => request.options.method === 'DELETE' || new URL(request.url).pathname.endsWith('/expire')).length, 0);
});

test('Stripe Checkout completion racing expiration is re-fetched, credited and renewal-canceled without revoking paid access', async t => {
  const s = setup(t), order = await s.checkout(), saved = s.billing.ledger.ownedOrder(order.id, user.id);
  s.expireRaces.set(saved.session_id, () => s.paidStripe(order));
  const result = await s.billing.cancel(user.id, order.id); assert.equal(result.status, 'paid'); assert.equal(result.cancelAtPeriodEnd, true);
  assert.equal(s.billing.membership(user.id).planId, 'pro'); assert.equal(s.billing.ledger.history(user.id).length, 1);
  assert.equal(s.requests.filter(request => request.options.method === 'DELETE' || new URL(request.url).pathname.endsWith('/void')).length, 0);
});

test('quota reservation is atomic, counts queued work, prevents cross-user reuse and settles each job only once', async t => {
  const s = setup(t, { env: { BILLING_FREE_MONTHLY_GENERATIONS: '2' } });
  const results = await Promise.allSettled(['a', 'b', 'c', 'd'].map(id => Promise.resolve().then(() => s.billing.reserveUsage(user.id, id))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 402).length, 2);
  assert.equal(s.billing.membership(user.id).usage.reserved, 2); assert.throws(() => s.billing.reserveUsage('user_mallory', 'a'), { code: 'INVALID_USAGE_RESERVATION' });
  assert.equal(s.billing.settleUsage('a', 'succeeded'), true); assert.equal(s.billing.settleUsage('a', 'failed'), false);
  assert.equal(s.billing.settleUsage('b', 'canceled'), true); assert.equal(s.billing.membership(user.id).usage.used, 1); assert.equal(s.billing.membership(user.id).usage.remaining, 1);
  s.billing.reserveUsage(user.id, 'e'); s.billing.settleUsage('e', 'failed'); assert.equal(s.billing.membership(user.id).usage.remaining, 1);
});

test('SQLite persisted usage survives restart, reconciles actual terminal jobs and resets monthly buckets', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-billing-')), db = new DatabaseSync(path.join(dir, 'identity.sqlite'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const s = setup(t, { db }); s.billing.reserveUsage(user.id, 'running'); s.billing.reserveUsage(user.id, 'completed'); s.billing.reserveUsage(user.id, 'abandoned');
  const restarted = createBilling({ db, env: s.env, clock: s.time });
  restarted.reconcileUsage([{ id: 'running', status: 'running' }, { id: 'completed', status: 'succeeded' }]);
  assert.equal(restarted.membership(user.id).usage.reserved, 1); assert.equal(restarted.membership(user.id).usage.used, 1);
  s.advance(86400000); assert.equal(restarted.membership(user.id).usage.bucket, '2026-02'); assert.equal(restarted.membership(user.id).usage.used, 0);
});

test('production requires public HTTPS origin and canonical Alipay JSON retains original signed bytes', () => {
  const db = new DatabaseSync(':memory:');
  assert.throws(() => createBilling({ db, env: { NODE_ENV: 'production', APP_BASE_URL: 'http://studio.example.test' } }), /HTTPS/);
  assert.throws(() => createBilling({ db, env: { APP_BASE_URL: 'https://studio.example.test/unsafe?x=1' } }), /origin/);
  db.close();
  const json = '{"sign":"x", "reply" : { "unicode":"雪山", "brace":"}\\\"", "array":[1,{"x":2}] }}';
  assert.equal(rawJsonProperty(json, 'reply'), '{ "unicode":"雪山", "brace":"}\\\"", "array":[1,{"x":2}] }');
  assert.throws(() => rawJsonProperty('{"reply":{},"reply":{}}', 'reply'), /Duplicate/);
  assert.equal(minorAmount('12.30'), 1230); assert.equal(minorAmount('12.3'), 1230); assert.equal(minorAmount('1e3'), null); assert.equal(minorAmount('12.333'), null);
  assert.equal(alipayTimestamp(Date.UTC(2026, 0, 1)), '2026-01-01 08:00:00');
});

test('public price requests are coalesced and cached; authenticated order polling recovers missed paid webhooks', async t => {
  const s = setup(t);
  await Promise.all(Array.from({ length: 30 }, () => s.billing.plans()));
  assert.equal(s.requests.filter(r => new URL(r.url).pathname.startsWith('/v1/prices/')).length, 4);
  await s.billing.plans(); assert.equal(s.requests.length, 4);
  const order = await s.checkout(), paid = s.paidStripe(order);
  assert.equal(s.billing.membership(user.id).planId, 'free');
  assert.equal((await s.billing.refreshOrder(user.id, order.id)).status, 'paid');
  assert.equal(s.billing.membership(user.id).planId, 'pro');
  assert.equal(s.billing.ledger.history(user.id)[0].id, paid.invoiceId);
});

test('HTTP routes enforce auth and CSRF while callbacks verify untouched raw bytes before global JSON parsing', async t => {
  const s = setup(t), app = express();
  const auth = (req, res, next) => { if (req.get('x-test-user') !== 'alice') return res.status(401).json({ code: 'AUTH_REQUIRED' }); req.user = user; next(); };
  const csrf = (req, res, next) => { if (req.get('x-csrf-token') !== 'fixture') return res.status(403).json({ code: 'CSRF_INVALID' }); next(); };
  s.billing.installRoutes(app, { requireAuth: auth, requireCsrf: csrf });
  app.use(express.json());
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
  const server = await new Promise((resolve, reject) => { const srv = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(srv)); srv.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ provider: 'stripe', planId: 'pro', interval: 'monthly' });
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  assert.equal((await fetch(base + '/api/billing/checkout', { method: 'POST', headers, body })).status, 401);
  assert.equal((await fetch(base + '/api/billing/checkout', { method: 'POST', headers: { ...headers, 'x-test-user': 'alice' }, body })).status, 403);
  const purchased = await fetch(base + '/api/billing/checkout', { method: 'POST', headers: { ...headers, 'x-test-user': 'alice', 'x-csrf-token': 'fixture' }, body });
  assert.equal(purchased.status, 201); const order = await purchased.json(); const paid = s.paidStripe(order);
  assert.equal((await fetch(base + '/api/billing/return?order=' + order.id, { redirect: 'manual' })).status, 303);
  assert.equal(s.billing.membership(user.id).planId, 'free', 'browser return cannot grant');
  const raw = '{ "id":"evt_http", "type":"invoice.paid", "data":{"object":{"id":"' + paid.invoiceId + '"}} }';
  const timestamp = Math.floor(s.time() / 1000), sign = createHmac('sha256', s.env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.' + raw).digest('hex');
  const callback = await fetch(base + '/api/billing/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${sign}` }, body: raw });
  assert.equal(callback.status, 200); assert.equal(s.billing.membership(user.id).planId, 'pro');
  const forged = await fetch(base + '/api/billing/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${sign}` }, body: JSON.stringify(JSON.parse(raw)) });
  assert.equal(forged.status, 400); assert.equal((await forged.json()).code, 'INVALID_PAYMENT_SIGNATURE');
  assert.equal((await fetch(base + '/api/billing/status')).status, 401);
  assert.equal((await fetch(base + '/api/billing/history', { headers: { 'x-test-user': 'alice' } })).status, 200);
});
