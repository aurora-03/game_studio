import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { billingConfig, billingError, providerReady, selectedPlan, minorAmount } from './config.js';
import { paymentProviders, verifyStripeSignature, verifyAlipayNotification, verifiedAlipayAmount } from './providers.js';
import { billingLedger } from './ledger.js';

const objectId = value => typeof value === 'string' ? value : value?.id;
const validProviderId = (id, prefix) => typeof id === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id);
const seconds = value => Number.isSafeInteger(value) && value > 0 ? value * 1000 : null;
function providerUrl(value, hostname) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === hostname && !url.port && !url.username && !url.password; }
  catch { return false; }
}
function addInterval(time, interval) {
  const date = new Date(time), day = date.getUTCDate();
  date.setUTCDate(1);
  if (interval === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end));
  return date.getTime();
}

export function createBilling({ db, env = process.env, fetch: fetcher = globalThis.fetch, clock = Date.now } = {}) {
  if (!db) throw new Error('Billing requires the persistent identity SQLite database.');
  let closed = false, closePromise = null;
  const abort = new AbortController(), requestScope = new AsyncLocalStorage(), tasks = new Set();
  const ensureOpen = () => { if (closed) throw billingError(503, 'BILLING_CLOSED', 'The billing service is shutting down. Please retry.'); };
  const config = billingConfig(env), ledger = billingLedger(db, config, clock, () => closed), providers = paymentProviders(config, fetcher, clock,
    () => requestScope.getStore()?.signal ? AbortSignal.any([abort.signal, requestScope.getStore().signal]) : abort.signal);
  const { get, all, run, transaction } = ledger;
  const busy = new Set(), prices = new Map(), pendingPrices = new Map(), priceFailures = new Map();
  let publicPlans = null, publicPlansPending = null;
  let portalSetupPending = null;
  // Single-instance workers serialize provider synchronization. A response fetched
  // before a cancellation/refund must not overwrite one fetched after it.
  let providerSync = Promise.resolve();
  const synchronize = fn => {
    const pending = providerSync.catch(() => {}).then(() => { ensureOpen(); return fn(); });
    providerSync = pending;
    return pending;
  };
  const task = fn => {
    const pending = Promise.resolve().then(() => { ensureOpen(); return fn(); });
    tasks.add(pending);
    return pending.finally(() => tasks.delete(pending));
  };
  let timer = null, reconcileRunning = false;
  async function priceFor(plan, interval) {
    const id = plan.stripe[interval];
    if (!id || !validProviderId(id, 'price')) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The Stripe price for this plan has not been configured.');
    const cached = prices.get(id);
    if (cached && cached.expires > clock()) return cached.price;
    if (priceFailures.get(id) > clock()) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The Stripe plan price is temporarily unavailable.');
    if (pendingPrices.has(id)) return pendingPrices.get(id);
    const request = (async () => {
    const price = await providers.stripe('/prices/' + id);
    if (price.id !== id || !price.active || price.type !== 'recurring' || !Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0 || price.billing_scheme !== 'per_unit' || price.transform_quantity || !/^[a-z]{3}$/.test(price.currency || '') || price.recurring?.interval !== (interval === 'yearly' ? 'year' : 'month') || price.recurring?.interval_count !== 1 || price.recurring?.usage_type !== 'licensed') {
      throw billingError(503, 'INVALID_STRIPE_PRICE', 'Configure a positive, fixed recurring Stripe price with one monthly or yearly interval.');
    }
    prices.set(id, { price, expires: clock() + 5 * 60000 });
    return price;
    })().catch(error => { priceFailures.set(id, clock() + 60000); throw error; }).finally(() => pendingPrices.delete(id));
    pendingPrices.set(id, request);
    return request;
  }
  async function plans() {
    if (publicPlans && publicPlans.expires > clock()) return publicPlans.value;
    if (publicPlansPending) return publicPlansPending;
    publicPlansPending = (async () => {
    const value = {
      providers: { stripe: { available: providerReady(config, 'stripe'), recurring: true }, alipay: { available: providerReady(config, 'alipay'), recurring: false } },
      plans: await Promise.all(config.plans.map(async plan => ({ id: plan.id, name: plan.name, monthlyGenerations: plan.monthlyGenerations,
        prices: await Promise.all(['monthly', 'yearly'].map(async interval => {
          let stripe = null;
          if (plan.id !== 'free' && providerReady(config, 'stripe') && plan.stripe[interval]) {
            try { const price = await priceFor(plan, interval); stripe = { amount: price.unit_amount, currency: price.currency, available: true }; }
            catch { stripe = { amount: null, currency: null, available: false }; }
          }
          const amount = plan.alipay[interval];
          return { interval, stripe, alipay: amount > 0 ? { amount, currency: 'cny', available: providerReady(config, 'alipay') } : null };
        })) }))) };
    publicPlans = { value, expires: clock() + 60000 };
    return value;
    })().finally(() => { publicPlansPending = null; });
    return publicPlansPending;
  }
  async function checkout(user, body, key) {
    const { provider, planId } = body || {}, interval = body?.interval === 'annual' ? 'yearly' : body?.interval;
    // A retry of an existing order must keep its original price snapshot even
    // when an operator changes environment price mappings during an outage.
    const plan = config.plans.find(item => item.id === planId && item.id !== 'free');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw billingError(400, 'CHECKOUT_KEY_REQUIRED', 'Supply an Idempotency-Key containing 8–100 letters, digits, dashes or underscores.');
    if (busy.has(user.id)) throw billingError(409, 'CHECKOUT_IN_PROGRESS', 'A payment request for your account is already being processed.');
    busy.add(user.id);
    try {
      const previous = get('SELECT * FROM billing_orders WHERE user_id=? AND idempotency_key=?', user.id, key);
      if (previous) {
        if (previous.provider !== provider || previous.plan_id !== planId || previous.interval !== interval) throw billingError(409, 'IDEMPOTENCY_CONFLICT', 'This checkout key belongs to a different plan.');
        if (previous.status !== 'pending' || previous.expires_at <= clock()) return ledger.publicOrder(previous);
        if (previous.checkout_url) return ledger.publicOrder(previous);
      } else {
        selectedPlan(config, planId, interval, provider);
        // Recover a completed-but-undelivered checkout before allowing a new
        // subscription, including one whose locally recorded deadline elapsed.
        const outstanding = get("SELECT * FROM billing_orders WHERE user_id=? AND provider='stripe' AND status='pending' AND session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", user.id);
        if (outstanding) await synchronize(() => syncStripeOrder(outstanding));
        const active = ledger.membership(user.id);
        const runningSub = get("SELECT id FROM billing_subscriptions WHERE user_id=? AND status IN ('active','past_due','incomplete','trialing','unpaid','paused') LIMIT 1", user.id);
        if (runningSub) throw billingError(409, 'ACTIVE_SUBSCRIPTION_EXISTS', 'Manage or cancel your existing Stripe subscription before purchasing another plan.');
        if (active.provider && (active.provider !== provider || active.planId !== planId)) throw billingError(409, 'ACTIVE_MEMBERSHIP_EXISTS', 'Your current prepaid membership must end before changing its plan or payment provider.');
        const pending = get("SELECT id FROM billing_orders WHERE user_id=? AND status='pending' AND expires_at>? LIMIT 1", user.id, clock());
        if (pending) throw billingError(409, 'PENDING_CHECKOUT_EXISTS', 'Complete or cancel your existing checkout before starting another.');
      }
      if (!providerReady(config, provider)) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'This payment provider has not been configured.');
      const price = provider === 'stripe' ? (previous ? { id: previous.price_id, unit_amount: previous.amount, currency: previous.currency } : await priceFor(plan, interval)) : null;
      const order = previous || ledger.createOrder({ userId: user.id, key, provider, planId, interval, amount: price?.unit_amount || plan.alipay[interval], currency: price?.currency || 'cny', priceId: price?.id });
      let checkoutUrl, sessionId = null;
      if (provider === 'alipay') checkoutUrl = providers.alipayCheckout(order);
      else {
        let customer = get('SELECT stripe_customer FROM billing_customers WHERE user_id=?', user.id)?.stripe_customer;
        if (!customer) {
          const created = await providers.stripe('/customers', { method: 'POST', idempotencyKey: 'gamestudio-customer-' + user.id,
            params: { 'metadata[gamestudio_user_id]': user.id, ...(user.email ? { email: user.email } : {}), ...(user.name ? { name: user.name } : {}) } });
          if (!validProviderId(created.id, 'cus')) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not return a valid customer.');
          customer = created.id;
          run('INSERT INTO billing_customers(user_id,stripe_customer) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING', user.id, customer);
          if (get('SELECT stripe_customer FROM billing_customers WHERE user_id=?', user.id)?.stripe_customer !== customer) throw billingError(409, 'PAYMENT_IDENTITY_MISMATCH', 'Stripe customer identity conflict.');
        }
        const session = await providers.stripe('/checkout/sessions', { method: 'POST', idempotencyKey: 'gamestudio-checkout-' + order.id, params: {
          mode: 'subscription', customer, client_reference_id: user.id,
          'line_items[0][price]': price.id, 'line_items[0][quantity]': 1,
          'metadata[gamestudio_order_id]': order.id, 'metadata[gamestudio_user_id]': user.id,
          'subscription_data[metadata][gamestudio_order_id]': order.id, 'subscription_data[metadata][gamestudio_user_id]': user.id,
          success_url: config.origin + '/api/billing/return?order=' + order.id,
          cancel_url: config.origin + '/?billing=cancelled&order=' + order.id + '#billing',
          expires_at: Math.floor(order.expires_at / 1000), 'allow_promotion_codes': false,
        } });
        if (!validProviderId(session.id, 'cs') || !providerUrl(session.url, 'checkout.stripe.com')) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not return a valid checkout page.');
        checkoutUrl = session.url; sessionId = session.id;
      }
      run('UPDATE billing_orders SET checkout_url=?,session_id=? WHERE id=?', checkoutUrl, sessionId, order.id);
      return ledger.publicOrder(get('SELECT * FROM billing_orders WHERE id=?', order.id));
    } finally { busy.delete(user.id); }
  }
  function stripeContext(subscription) {
    const customer = objectId(subscription.customer), user = get('SELECT user_id FROM billing_customers WHERE stripe_customer=?', customer);
    const id = subscription.metadata?.gamestudio_order_id;
    const order = id ? get("SELECT * FROM billing_orders WHERE id=? AND provider='stripe'", id) : null;
    if (!user || !order || order.user_id !== user.user_id || subscription.metadata?.gamestudio_user_id !== user.user_id || (order.subscription_id && order.subscription_id !== subscription.id)) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'This Stripe subscription does not match an application order and customer.');
    const items = subscription.items?.data;
    if (!Array.isArray(items) || items.length !== 1 || items[0].quantity !== 1 || objectId(items[0].price) !== order.price_id) throw billingError(400, 'PAYMENT_PLAN_MISMATCH', 'The Stripe subscription price does not match the order.');
    return { order, item: items[0] };
  }
  function saveSubscription(subscription, order) {
    const item = subscription.items?.data?.[0], end = seconds(subscription.current_period_end) || seconds(item?.current_period_end) || 0;
    run('INSERT INTO billing_subscriptions(id,user_id,order_id,status,cancel_at_period_end,current_period_end,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,current_period_end=excluded.current_period_end,updated_at=excluded.updated_at', subscription.id, order.user_id, order.id, subscription.status, subscription.cancel_at_period_end ? 1 : 0, end, clock());
    run('UPDATE billing_orders SET subscription_id=?,last_synced_at=? WHERE id=?', subscription.id, clock(), order.id);
  }
  async function syncInvoice(id) {
    if (!validProviderId(id, 'in')) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid invoice ID.');
    const invoice = await providers.stripe('/invoices/' + id);
    if (invoice.id !== id) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The retrieved invoice ID does not match the notification.');
    const subId = objectId(invoice.subscription) || objectId(invoice.parent?.subscription_details?.subscription);
    if (!subId) return; // Other merchant invoices are outside this application.
    if (!validProviderId(subId, 'sub')) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid subscription ID.');
    const subscription = await providers.stripe('/subscriptions/' + subId);
    if (subscription.id !== subId) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The retrieved subscription ID does not match the invoice.');
    if (!subscription.metadata?.gamestudio_order_id) return;
    persistStripeInvoice(invoice, subscription);
  }
  function persistStripeInvoice(invoice, subscription) {
    const { order, item } = stripeContext(subscription);
    if (objectId(invoice.customer) !== objectId(subscription.customer)) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The invoice customer does not match the subscription.');
    const paid = invoice.status === 'paid' && invoice.paid === true && invoice.amount_paid === order.amount && invoice.amount_due === order.amount && invoice.currency === order.currency && !invoice.paid_out_of_band;
    const line = invoice.lines?.data?.find(line => objectId(line.price) === order.price_id || line.pricing?.price_details?.price === order.price_id);
    if (invoice.status === 'paid' && (!paid || !line || line.quantity !== 1 || line.proration || invoice.lines?.has_more || invoice.lines.data.length !== 1)) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The settled invoice amount or price does not match the order.');
    transaction(() => {
      saveSubscription(subscription, order);
      if (!paid) return;
      const startsAt = seconds(line.period?.start) || seconds(subscription.current_period_start) || seconds(item.current_period_start);
      const endsAt = seconds(line.period?.end) || seconds(subscription.current_period_end) || seconds(item.current_period_end);
      const receipt = providerUrl(invoice.hosted_invoice_url, 'invoice.stripe.com') ? invoice.hosted_invoice_url : null;
      ledger.grantPayment({ id: invoice.id, order, subscriptionId: subscription.id, startsAt, endsAt, paidAt: seconds(invoice.status_transitions?.paid_at) || clock(), receiptUrl: receipt });
    });
    return { order, paid };
  }
  async function syncSubscription(id) {
    if (!validProviderId(id, 'sub')) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid subscription ID.');
    const subscription = await providers.stripe('/subscriptions/' + id);
    if (subscription.id !== id) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The retrieved subscription ID does not match the notification.');
    if (!subscription.metadata?.gamestudio_order_id) return;
    const { order } = stripeContext(subscription);
    transaction(() => saveSubscription(subscription, order));
    const invoiceId = objectId(subscription.latest_invoice);
    if (invoiceId && ['active', 'past_due'].includes(subscription.status)) await syncInvoice(invoiceId);
  }
  async function readStripeSession(order) {
    if (!order.session_id) return null;
    const session = await providers.stripe('/checkout/sessions/' + order.session_id);
    const customer = get('SELECT stripe_customer FROM billing_customers WHERE user_id=?', order.user_id)?.stripe_customer;
    if (session.id !== order.session_id || session.metadata?.gamestudio_order_id !== order.id || session.client_reference_id !== order.user_id || objectId(session.customer) !== customer) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The checkout session does not match this order.');
    return session;
  }
  async function syncStripeOrder(order) {
    const session = await readStripeSession(order);
    if (!session) return;
    const subscription = objectId(session.subscription);
    if (subscription) await syncSubscription(subscription);
    if (session.status === 'expired') run("UPDATE billing_orders SET status='expired',last_synced_at=? WHERE id=? AND status='pending'", clock(), order.id);
    else run('UPDATE billing_orders SET last_synced_at=? WHERE id=?', clock(), order.id);
  }
  async function syncAlipayOrder(order, notification) {
    const trade = await providers.alipay('alipay.trade.query', { out_trade_no: order.merchant_order_id });
    if (!trade) { run('UPDATE billing_orders SET last_synced_at=? WHERE id=?', clock(), order.id); return; }
    verifiedAlipayAmount(trade.total_amount, order.amount);
    if (trade.out_trade_no !== order.merchant_order_id || !trade.trade_no || (order.trade_id && order.trade_id !== trade.trade_no) || (notification && notification.trade_no !== trade.trade_no)) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The Alipay transaction does not match this order.');
    if (trade.seller_id && trade.seller_id !== config.alipay.sellerId) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The Alipay transaction belongs to a different seller.');
    transaction(() => {
      run('UPDATE billing_orders SET trade_id=?,last_synced_at=? WHERE id=?', trade.trade_no, clock(), order.id);
      const paymentId = 'alipay:' + trade.trade_no;
      // trade.query reports a full refund as TRADE_CLOSED. Partial refund totals
      // are carried by RSA2-signed asynchronous notifications as refund_fee;
      // there is no refund_amount field in the official trade.query response.
      const refund = minorAmount(notification?.refund_fee || '0.00');
      if (refund === null) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid refund amount from Alipay.');
      if (refund > order.amount) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The Alipay refund exceeds the original order amount.');
      if (refund > 0) ledger.recordRefund({ id: paymentId + ':refund:' + refund, paymentId, amount: refund, full: refund >= order.amount });
      if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(trade.trade_status)) {
        const existing = get('SELECT id FROM billing_payments WHERE id=?', paymentId);
        if (!existing) {
          const latest = get("SELECT MAX(ends_at) AS end FROM billing_payments WHERE user_id=? AND provider='alipay' AND plan_id=? AND status='paid'", order.user_id, order.plan_id);
          const startsAt = Math.max(clock(), latest?.end || 0);
          ledger.grantPayment({ id: paymentId, order, startsAt, endsAt: addInterval(startsAt, order.interval) });
        }
      } else if (trade.trade_status === 'TRADE_CLOSED') {
        const paid = get('SELECT * FROM billing_payments WHERE id=?', paymentId);
        if (paid) ledger.recordRefund({ id: paymentId + ':closed', paymentId, amount: order.amount, full: true });
        else run("UPDATE billing_orders SET status='canceled' WHERE id=? AND status='pending'", order.id);
      }
    });
  }
  async function syncCharge(id, dispute) {
    if (!validProviderId(id, 'ch')) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid charge ID.');
    const charge = await providers.stripe('/charges/' + id);
    if (charge.id !== id) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The retrieved charge ID does not match the notification.');
    const invoiceId = objectId(charge.invoice);
    if (!invoiceId) return;
    const invoice = await providers.stripe('/invoices/' + invoiceId);
    const subId = objectId(invoice.subscription) || objectId(invoice.parent?.subscription_details?.subscription);
    if (!subId) return;
    const subscription = await providers.stripe('/subscriptions/' + subId);
    if (!subscription.metadata?.gamestudio_order_id) return;
    const { order } = stripeContext(subscription);
    if (objectId(charge.customer) !== objectId(subscription.customer) || charge.currency !== order.currency || charge.amount !== order.amount) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The refunded payment does not match its application order.');
    transaction(() => {
      if (Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded > 0) ledger.recordRefund({ id: charge.id + ':refund:' + charge.amount_refunded, paymentId: invoiceId, amount: charge.amount_refunded, full: charge.amount_refunded >= charge.amount });
      if (dispute) {
        if (['won', 'warning_closed', 'prevented'].includes(dispute.status)) {
          run("DELETE FROM billing_refunds WHERE id=? AND reason='dispute'", 'dispute:' + dispute.id);
          const stillBlocked = get("SELECT id FROM billing_refunds WHERE payment_id=? AND reason IN ('dispute','full_refund')", invoiceId);
          if (!stillBlocked) { run("UPDATE billing_payments SET status='paid' WHERE id=?", invoiceId); run("UPDATE billing_orders SET status='paid' WHERE id=? AND status='refunded'", order.id); }
        } else ledger.recordRefund({ id: 'dispute:' + dispute.id, paymentId: invoiceId, amount: dispute.amount || order.amount, full: true, dispute: true });
      }
    });
  }
  async function stripeWebhook(raw, signature) {
    if (!providerReady(config, 'stripe')) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Stripe notifications are not configured.');
    const event = verifyStripeSignature(raw, signature, config.stripe.webhookSecret, clock());
    if (!validProviderId(event.id, 'evt') || typeof event.type !== 'string' || !event.data?.object?.id || event.account) throw billingError(400, 'INVALID_PAYMENT_EVENT', 'Invalid or unsupported Stripe notification.');
    if (get("SELECT id FROM billing_events WHERE provider='stripe' AND id=?", event.id)) return { received: true, duplicate: true };
    const id = event.data.object.id;
    if (event.type.startsWith('invoice.')) await syncInvoice(id);
    else if (event.type.startsWith('customer.subscription.')) await syncSubscription(id);
    else if (event.type.startsWith('checkout.session.')) {
      const order = get("SELECT * FROM billing_orders WHERE session_id=? AND provider='stripe'", id);
      if (order) await syncStripeOrder(order);
    } else if (event.type === 'charge.refunded') await syncCharge(id);
    else if (event.type.startsWith('charge.dispute.')) {
      const dispute = await providers.stripe('/disputes/' + id);
      await syncCharge(objectId(dispute.charge), dispute);
    } else if (event.type.startsWith('refund.')) {
      const refund = await providers.stripe('/refunds/' + id);
      if (refund.status === 'succeeded') await syncCharge(objectId(refund.charge));
    }
    run('INSERT OR IGNORE INTO billing_events(provider,id,type,processed_at) VALUES(?,?,?,?)', 'stripe', event.id, event.type, clock());
    return { received: true };
  }
  async function alipayWebhook(params) {
    if (!providerReady(config, 'alipay')) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Alipay notifications are not configured.');
    verifyAlipayNotification(params, config.alipay);
    const order = get("SELECT * FROM billing_orders WHERE merchant_order_id=? AND provider='alipay'", params.out_trade_no);
    if (!order) throw billingError(404, 'ORDER_NOT_FOUND', 'The Alipay order was not found.');
    verifiedAlipayAmount(params.total_amount, order.amount);
    const eventId = params.notify_id || createHash('sha256').update(JSON.stringify(params)).digest('hex');
    if (get("SELECT id FROM billing_events WHERE provider='alipay' AND id=?", eventId)) return;
    await syncAlipayOrder(order, params);
    run('INSERT OR IGNORE INTO billing_events(provider,id,type,processed_at) VALUES(?,?,?,?)', 'alipay', eventId, params.trade_status || 'notification', clock());
  }
  async function refreshOrder(userId, id) {
    const order = ledger.ownedOrder(id, userId);
    if (clock() - order.last_synced_at >= 5000 && providerReady(config, order.provider)) {
      if (order.provider === 'stripe') await syncStripeOrder(order); else await syncAlipayOrder(order);
    }
    return ledger.publicOrder(ledger.ownedOrder(id, userId));
  }
  function verifyPortalConfiguration(configuration, expectedId, owned = false) {
    if (!validProviderId(configuration?.id, 'bpc') || (expectedId && configuration.id !== expectedId) || configuration.active !== true
      || configuration.features?.subscription_update?.enabled !== false || (configuration.features?.subscription_cancel?.enabled === true && configuration.features.subscription_cancel.mode !== 'at_period_end')
      || (owned && (configuration.is_default !== false || configuration.features?.invoice_history?.enabled !== true || configuration.features?.payment_method_update?.enabled !== true || configuration.features?.customer_update?.enabled !== true || configuration.features?.subscription_cancel?.enabled !== true))) {
      throw billingError(503, 'UNSAFE_PORTAL_CONFIGURATION', 'The billing portal is unavailable because its subscription settings do not match this membership service. You can still cancel renewal from your account.');
    }
    return configuration.id;
  }
  async function safePortalConfiguration() {
    if (portalSetupPending) return portalSetupPending;
    portalSetupPending = (async () => {
      const explicit = config.stripe.portalConfiguration;
      if (explicit) {
        if (!validProviderId(explicit, 'bpc')) throw billingError(503, 'UNSAFE_PORTAL_CONFIGURATION', 'The billing portal configuration is invalid.');
        return verifyPortalConfiguration(await providers.stripe('/billing_portal/configurations/' + explicit), explicit);
      }
      // Store an account-key/origin/policy fingerprint, never the secret key.
      // This creates a separate configuration and never edits Stripe's default.
      const fingerprint = createHash('sha256').update('gamestudio-portal-v1\0' + config.origin + '\0' + config.stripe.secretKey).digest('hex');
      const settingKey = 'stripe:portal:' + fingerprint;
      const stored = get('SELECT value FROM billing_provider_settings WHERE key=?', settingKey)?.value;
      if (stored) {
        if (!validProviderId(stored, 'bpc')) throw billingError(503, 'UNSAFE_PORTAL_CONFIGURATION', 'The stored billing portal configuration is invalid.');
        // Revalidate before each session so an operator edit cannot silently
        // enable unsupported paid plan changes after a configuration was cached.
        return verifyPortalConfiguration(await providers.stripe('/billing_portal/configurations/' + stored), stored, true);
      }
      const configuration = await providers.stripe('/billing_portal/configurations', { method: 'POST', idempotencyKey: 'gamestudio-portal-' + fingerprint, params: {
        'business_profile[headline]': 'GameStudio membership', default_return_url: config.origin + '/#billing',
        'features[invoice_history][enabled]': true, 'features[payment_method_update][enabled]': true,
        'features[customer_update][enabled]': true, 'features[customer_update][allowed_updates][0]': 'email',
        'features[customer_update][allowed_updates][1]': 'address', 'features[customer_update][allowed_updates][2]': 'tax_id',
        'features[subscription_cancel][enabled]': true, 'features[subscription_cancel][mode]': 'at_period_end',
        'features[subscription_cancel][proration_behavior]': 'none', 'features[subscription_update][enabled]': false,
        'metadata[gamestudio_origin]': config.origin, 'metadata[gamestudio_policy]': 'membership-v1',
      } });
      const id = verifyPortalConfiguration(configuration, null, true);
      run('INSERT INTO billing_provider_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', settingKey, id, clock());
      return id;
    })().finally(() => { portalSetupPending = null; });
    return portalSetupPending;
  }
  async function portal(userId) {
    if (!providerReady(config, 'stripe')) throw billingError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Stripe billing management is not configured.');
    const customer = get('SELECT stripe_customer FROM billing_customers WHERE user_id=?', userId)?.stripe_customer;
    if (!customer) throw billingError(404, 'BILLING_CUSTOMER_NOT_FOUND', 'Your account has no Stripe billing history.');
    const configuration = await safePortalConfiguration();
    const session = await providers.stripe('/billing_portal/sessions', { method: 'POST', params: { customer, return_url: config.origin + '/#billing', configuration } });
    if (!providerUrl(session.url, 'billing.stripe.com') || objectId(session.customer) !== customer || objectId(session.configuration) !== configuration) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not return a valid billing portal.');
    return { url: session.url };
  }
  async function cancelRenewal(order, knownSubscription) {
    const current = knownSubscription || await providers.stripe('/subscriptions/' + order.subscription_id);
    const { order: owned } = stripeContext(current);
    if (owned.id !== order.id || current.id !== order.subscription_id) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The subscription does not match the cancellation order.');
    if (['canceled', 'incomplete_expired'].includes(current.status)) { transaction(() => saveSubscription(current, owned)); return; }
    // Setting this flag is intrinsically idempotent. A fresh action key avoids
    // Stripe replaying an old response after the customer resumed renewal.
    const subscription = await providers.stripe('/subscriptions/' + order.subscription_id, { method: 'POST', idempotencyKey: 'gamestudio-cancel-' + order.id + '-' + randomUUID(), params: { cancel_at_period_end: true } });
    const { order: verified } = stripeContext(subscription);
    if (subscription.id !== current.id || subscription.cancel_at_period_end !== true) throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not confirm cancellation at the end of the paid period. Please retry.');
    transaction(() => saveSubscription(subscription, verified));
  }
  const paymentProcessing = () => billingError(409, 'PAYMENT_PROCESSING', 'Payment is still processing. Wait for confirmation and check the order again before canceling.');
  async function stripeCancellationState(order) {
    const session = await readStripeSession(order), subId = objectId(session?.subscription) || order.subscription_id;
    if (!subId) return { session, subscription: null, invoice: null, intent: null, paidPeriod: false };
    if (!validProviderId(subId, 'sub')) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'Invalid subscription cancellation reference.');
    const subscription = await providers.stripe('/subscriptions/' + subId), { order: owned } = stripeContext(subscription);
    if (subscription.id !== subId || owned.id !== order.id) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The subscription does not match the cancellation order.');
    const invoiceId = objectId(subscription.latest_invoice);
    let invoice = null, intent = null;
    if (invoiceId) {
      if (!validProviderId(invoiceId, 'in')) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'Invalid cancellation invoice reference.');
      invoice = await providers.stripe('/invoices/' + invoiceId);
      const line = invoice.lines?.data?.find(value => objectId(value.price) === order.price_id || value.pricing?.price_details?.price === order.price_id);
      if (invoice.id !== invoiceId || objectId(invoice.customer) !== objectId(subscription.customer) || (objectId(invoice.subscription) || objectId(invoice.parent?.subscription_details?.subscription)) !== subId) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The cancellation invoice does not match its subscription and customer.');
      if (invoice.status === 'draft') throw paymentProcessing(); // Its amount/intent are not finalized yet.
      if (invoice.currency !== order.currency || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < 0 || invoice.amount_paid > order.amount || (invoice.status !== 'void' && invoice.amount_due !== order.amount)
        || !line || line.quantity !== 1 || line.proration || invoice.lines.has_more || invoice.lines.data.length !== 1) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The cancellation invoice does not match the original order amount and price.');
      const intentId = objectId(invoice.payment_intent);
      if (intentId) {
        if (!validProviderId(intentId, 'pi')) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'Invalid invoice payment reference.');
        intent = await providers.stripe('/payment_intents/' + intentId);
        if (intent.id !== intentId || objectId(intent.customer) !== objectId(subscription.customer) || (intent.invoice && objectId(intent.invoice) !== invoiceId)) throw billingError(400, 'PAYMENT_IDENTITY_MISMATCH', 'The payment does not belong to this cancellation invoice.');
        if (intent.currency !== order.currency || intent.amount !== order.amount || !Number.isSafeInteger(intent.amount_received) || intent.amount_received < 0 || intent.amount_received > order.amount) throw billingError(400, 'PAYMENT_AMOUNT_MISMATCH', 'The payment does not match the cancellation order amount.');
      }
      persistStripeInvoice(invoice, subscription);
    } else transaction(() => saveSubscription(subscription, owned));
    const paidPeriod = Boolean(get("SELECT id FROM billing_payments WHERE order_id=? AND status='paid' AND starts_at<=? AND ends_at>? LIMIT 1", order.id, clock(), clock()));
    return { session, subscription, invoice, intent, paidPeriod };
  }
  async function cancelPendingStripe(order, retried = false) {
    try {
      let state = await stripeCancellationState(order);
      if (state.paidPeriod && ['active', 'past_due'].includes(state.subscription?.status)) {
        await cancelRenewal(ledger.ownedOrder(order.id, order.user_id), state.subscription); return;
      }
      if (!state.subscription) {
        if (state.session?.status === 'open') {
          const expired = await providers.stripe('/checkout/sessions/' + order.session_id + '/expire', { method: 'POST', idempotencyKey: 'gamestudio-expire-' + order.id });
          if (expired.id !== order.session_id || expired.status !== 'expired') throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not confirm checkout expiration.');
        } else if (state.session && state.session.status !== 'expired') throw paymentProcessing();
        run("UPDATE billing_orders SET status='canceled',checkout_url=NULL,last_synced_at=? WHERE id=? AND status='pending'", clock(), order.id); return;
      }
      const unsettled = value => value.intent && (['processing', 'succeeded'].includes(value.intent.status) || value.intent.amount_received > 0);
      if (unsettled(state) || (state.invoice && state.invoice.amount_paid > 0)) throw paymentProcessing();
      if (!state.invoice) {
        if (!['canceled', 'incomplete_expired'].includes(state.subscription.status)) throw paymentProcessing();
      } else {
        if (['open', 'uncollectible'].includes(state.invoice.status)) {
          if (state.intent && !['requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture', 'canceled'].includes(state.intent.status)) throw paymentProcessing();
          // Invoice-owned/Checkout-owned intents cannot normally be canceled
          // directly. Voiding their finalized invoice cancels its intent and
          // disables the old hosted invoice link atomically in Stripe.
          const voided = await providers.stripe('/invoices/' + state.invoice.id + '/void', { method: 'POST', idempotencyKey: 'gamestudio-void-' + order.id + '-' + state.invoice.id });
          if (voided.id !== state.invoice.id || voided.status !== 'void') throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not confirm that the unpaid invoice was voided.');
          state = await stripeCancellationState(ledger.ownedOrder(order.id, order.user_id));
          if (state.paidPeriod && ['active', 'past_due'].includes(state.subscription?.status)) { await cancelRenewal(ledger.ownedOrder(order.id, order.user_id), state.subscription); return; }
        }
        if (!state.invoice || state.invoice.status !== 'void' || unsettled(state) || (state.intent && state.intent.status !== 'canceled')) throw paymentProcessing();
      }
      const current = ledger.ownedOrder(order.id, order.user_id);
      let ended = state.subscription;
      if (!['canceled', 'incomplete_expired'].includes(ended.status)) {
        ended = await providers.stripe('/subscriptions/' + ended.id, { method: 'DELETE', idempotencyKey: 'gamestudio-end-unpaid-' + order.id, params: { invoice_now: false, prorate: false } });
        const { order: owned } = stripeContext(ended);
        if (owned.id !== order.id || ended.id !== current.subscription_id || ended.status !== 'canceled') throw billingError(502, 'PAYMENT_PROVIDER_ERROR', 'Stripe did not confirm cancellation of the unpaid subscription.');
      }
      transaction(() => { saveSubscription(ended, current); run("UPDATE billing_orders SET status='canceled',checkout_url=NULL,last_synced_at=? WHERE id=? AND status='pending'", clock(), order.id); });
    } catch (error) {
      // A provider can reject expiration/voiding because the payment settled
      // between reads. Re-fetch once and preserve a verified paid period instead
      // of declaring cancellation or deleting a newly paid subscription.
      if (!retried && error.code === 'PAYMENT_PROVIDER_ERROR') return cancelPendingStripe(ledger.ownedOrder(order.id, order.user_id), true);
      throw error;
    }
  }
  async function cancel(userId, orderId) {
    const order = ledger.ownedOrder(orderId, userId);
    if (['canceled', 'expired'].includes(order.status)) return ledger.publicOrder(order);
    if (order.status === 'pending') {
      // Query first: a payment may have completed while the cancel button was pressed.
      if (order.provider === 'stripe') {
        await cancelPendingStripe(order);
      } else {
        await syncAlipayOrder(order);
        if (ledger.ownedOrder(orderId, userId).status === 'pending') await providers.alipay('alipay.trade.close', { out_trade_no: order.merchant_order_id });
      }
      run("UPDATE billing_orders SET status='canceled',checkout_url=NULL WHERE id=? AND status='pending'", order.id);
    } else if (order.provider === 'stripe' && order.subscription_id) {
      await cancelRenewal(order);
    } else throw billingError(409, 'MEMBERSHIP_NOT_RECURRING', 'Alipay membership is prepaid and ends automatically. Refunds are handled by support.');
    return ledger.publicOrder(ledger.ownedOrder(orderId, userId));
  }
  async function reconcileActive() {
    if (reconcileRunning) return;
    reconcileRunning = true;
    try {
      const deadline = Date.now() + 15000;
      const candidates = all("SELECT DISTINCT o.* FROM billing_orders o LEFT JOIN billing_payments p ON p.order_id=o.id LEFT JOIN billing_subscriptions s ON s.id=o.subscription_id WHERE o.last_synced_at<? AND ((o.status='pending' AND o.expires_at>?) OR (p.status='paid' AND p.ends_at>?) OR s.status IN ('active','past_due','unpaid','incomplete')) ORDER BY o.last_synced_at ASC LIMIT 5", clock() - 10 * 60000, clock(), clock());
      for (const order of candidates) {
        if (closed || Date.now() >= deadline) break;
        if (!providerReady(config, order.provider)) continue;
        try {
          // Hold the synchronization lock for one bounded order, then yield so
          // waiting webhooks/polls are serviced before the next background order.
          await synchronize(() => requestScope.run({ signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) }, async () => {
          if (order.provider === 'stripe') {
            if (order.subscription_id) await syncSubscription(order.subscription_id); else await syncStripeOrder(order);
          } else await syncAlipayOrder(order);
          }));
        } catch (error) { if (!closed) console.warn('[billing] reconciliation failed', order.id, error.code || 'PAYMENT_PROVIDER_ERROR'); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { reconcileRunning = false; }
  }
  function installRoutes(app, { requireAuth, requireCsrf } = {}) {
    if (typeof requireAuth !== 'function' || typeof requireCsrf !== 'function') throw new Error('Billing routes require authentication and CSRF middleware.');
    const asyncRoute = fn => (req, res, next) => task(() => fn(req, res)).catch(next);
    app.post('/api/billing/webhooks/stripe', express.raw({ type: 'application/json', limit: '256kb' }), asyncRoute(async (req, res) => res.json(await synchronize(() => stripeWebhook(req.body, req.get('stripe-signature'))))));
    app.post('/api/billing/webhooks/alipay', express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }), asyncRoute(async (req, res) => { await synchronize(() => alipayWebhook(req.body)); res.type('text/plain').send('success'); }));
    app.get('/api/billing/return', (req, res) => {
      // Browser redirects carry no payment authority. They only open the account
      // page, whose authenticated order polling queries the payment provider.
      const order = typeof req.query.order === 'string' && /^[a-f0-9-]{36}$/.test(req.query.order) ? req.query.order : '';
      res.redirect(303, config.origin + '/?billing=returned' + (order ? '&order=' + order : '') + '#billing');
    });
    app.get('/api/billing/plans', asyncRoute(async (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(await plans()); }));
    app.get('/api/billing/status', requireAuth, (req, res) => res.json(ledger.membership(req.user.id)));
    app.get('/api/billing/history', requireAuth, (req, res) => res.json({ payments: ledger.history(req.user.id), orders: ledger.orders(req.user.id) }));
    app.get('/api/billing/orders/:id', requireAuth, asyncRoute(async (req, res) => res.json(await synchronize(() => refreshOrder(req.user.id, req.params.id)))));
    app.post('/api/billing/checkout', requireAuth, requireCsrf, express.json({ limit: '8kb' }), asyncRoute(async (req, res) => res.status(201).json(await checkout(req.user, req.body, req.get('idempotency-key') || req.body?.idempotencyKey))));
    app.post('/api/billing/portal', requireAuth, requireCsrf, asyncRoute(async (req, res) => res.json(await portal(req.user.id))));
    app.post('/api/billing/orders/:id/cancel', requireAuth, requireCsrf, asyncRoute(async (req, res) => res.json(await synchronize(() => cancel(req.user.id, req.params.id)))));
    timer = setInterval(() => { void task(reconcileActive).catch(error => { if (!closed) console.warn('[billing] reconciliation failed', error.code || 'PAYMENT_PROVIDER_ERROR'); }); }, 60000); timer.unref();
  }
  return { config, ledger, plans: () => task(plans), checkout: (...args) => task(() => checkout(...args)), stripeWebhook: (...args) => task(() => synchronize(() => stripeWebhook(...args))), alipayWebhook: (...args) => task(() => synchronize(() => alipayWebhook(...args))),
    refreshOrder: (...args) => task(() => synchronize(() => refreshOrder(...args))), portal: (...args) => task(() => portal(...args)), cancel: (...args) => task(() => synchronize(() => cancel(...args))), reconcileActive: () => task(reconcileActive), installRoutes,
    membership: ledger.membership, reserveUsage: ledger.reserveUsage, settleUsage: ledger.settleUsage, reconcileUsage: ledger.reconcileUsage,
    close() { if (closePromise) return closePromise; closed = true; if (timer) clearInterval(timer); timer = null; abort.abort();
      closePromise = Promise.allSettled([...tasks, providerSync, ...pendingPrices.values(), ...(publicPlansPending ? [publicPlansPending] : [])]).then(() => undefined); return closePromise; } };
}
