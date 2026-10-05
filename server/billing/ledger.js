import { randomUUID } from 'node:crypto';
import { billingError } from './config.js';

export function billingLedger(db, config, clock = Date.now, isClosed = () => false) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_customers (user_id TEXT PRIMARY KEY, stripe_customer TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS billing_provider_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, provider TEXT NOT NULL,
      plan_id TEXT NOT NULL, interval TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
      price_id TEXT, merchant_order_id TEXT, status TEXT NOT NULL DEFAULT 'pending', checkout_url TEXT, session_id TEXT UNIQUE,
      subscription_id TEXT, trade_id TEXT UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      paid_at INTEGER, last_synced_at INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS billing_orders_owner ON billing_orders(user_id, created_at);
    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT NOT NULL, status TEXT NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0, current_period_end INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT NOT NULL, provider TEXT NOT NULL,
      subscription_id TEXT, plan_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'paid',
      receipt_url TEXT, paid_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS billing_payments_owner ON billing_payments(user_id, ends_at);
    CREATE TABLE IF NOT EXISTS billing_refunds (
      id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_events (provider TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, processed_at INTEGER NOT NULL, PRIMARY KEY(provider, id));
    CREATE TABLE IF NOT EXISTS billing_usage (
      job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bucket TEXT NOT NULL, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, settled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS billing_usage_owner ON billing_usage(user_id, bucket, state);
  `);
  // Merchant references are a provider protocol identifier, separate from the
  // public UUID. Preserve any reference already sent by a previous release.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(billing_orders)').all().some(column => column.name === 'merchant_order_id')) db.exec('ALTER TABLE billing_orders ADD COLUMN merchant_order_id TEXT');
    for (const order of db.prepare("SELECT id,checkout_url,trade_id FROM billing_orders WHERE provider='alipay' AND merchant_order_id IS NULL").all()) {
      const merchantId = order.checkout_url || order.trade_id ? order.id : 'gs_' + order.id.replaceAll('-', '');
      db.prepare('UPDATE billing_orders SET merchant_order_id=? WHERE id=?').run(merchantId, order.id);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_merchant ON billing_orders(merchant_order_id) WHERE merchant_order_id IS NOT NULL;
      CREATE TRIGGER IF NOT EXISTS billing_merchant_immutable BEFORE UPDATE OF merchant_order_id ON billing_orders
      WHEN NEW.merchant_order_id IS NOT OLD.merchant_order_id BEGIN SELECT RAISE(ABORT, 'Merchant order reference is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS billing_merchant_required BEFORE INSERT ON billing_orders
      WHEN NEW.provider='alipay' AND (NEW.merchant_order_id IS NULL OR LENGTH(NEW.merchant_order_id)<1 OR LENGTH(NEW.merchant_order_id)>64 OR NEW.merchant_order_id GLOB '*[^a-zA-Z0-9_]*')
      BEGIN SELECT RAISE(ABORT, 'Invalid Alipay merchant order reference'); END;`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const guard = () => { if (isClosed()) throw billingError(503, 'BILLING_CLOSED', 'The billing service is shutting down. Please retry.'); };
  const run = (sql, ...params) => { guard(); return db.prepare(sql).run(...params); };
  const get = (sql, ...params) => { guard(); return db.prepare(sql).get(...params); };
  const all = (sql, ...params) => { guard(); return db.prepare(sql).all(...params); };
  function transaction(fn) {
    guard();
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function membership(userId) {
    const now = clock(), ranks = { free: 0, pro: 1, studio: 2 };
    const eligible = all("SELECT p.* FROM billing_payments p LEFT JOIN billing_subscriptions s ON s.id=p.subscription_id WHERE p.user_id=? AND p.status='paid' AND p.starts_at<=? AND p.ends_at>? AND (p.provider!='stripe' OR s.status IN ('active','past_due'))", userId, now, now);
    eligible.sort((a, b) => (ranks[b.plan_id] - ranks[a.plan_id]) || b.ends_at - a.ends_at);
    const current = eligible[0];
    const plan = config.plans.find(p => p.id === (current?.plan_id || 'free')) || config.plans[0];
    const bucket = new Date(now).toISOString().slice(0, 7);
    const usage = get("SELECT SUM(CASE WHEN state='succeeded' THEN 1 ELSE 0 END) AS used, SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END) AS reserved FROM billing_usage WHERE user_id=? AND bucket=?", userId, bucket);
    const used = usage?.used || 0, reserved = usage?.reserved || 0;
    const sub = current?.subscription_id ? get('SELECT * FROM billing_subscriptions WHERE id=?', current.subscription_id) : null;
    return { planId: plan.id, planName: plan.name, provider: current?.provider || null, status: current ? (sub?.status || 'active') : 'free',
      expiresAt: current ? new Date(current.ends_at).toISOString() : null, cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
      subscriptionId: current?.subscription_id || null, monthlyGenerations: plan.monthlyGenerations,
      usage: { bucket, used, reserved, remaining: Math.max(0, plan.monthlyGenerations - used - reserved), resetsAt: new Date(Date.UTC(Number(bucket.slice(0, 4)), Number(bucket.slice(5, 7)), 1)).toISOString() } };
  }
  function reserveUsage(userId, jobId) {
    if (!userId || !jobId) throw billingError(400, 'INVALID_USAGE_RESERVATION', 'A user and job ID are required.');
    return transaction(() => {
      const existing = get('SELECT * FROM billing_usage WHERE job_id=?', jobId);
      if (existing) {
        if (existing.user_id !== userId || existing.state === 'released') throw billingError(409, 'INVALID_USAGE_RESERVATION', 'This generation reservation cannot be reused.');
        return existing;
      }
      const state = membership(userId);
      if (!state.usage.remaining) throw billingError(402, 'GENERATION_QUOTA_EXCEEDED', 'Your monthly generation allowance has been used. Upgrade your plan or wait for the next month.');
      run('INSERT INTO billing_usage(job_id,user_id,bucket,state,created_at) VALUES(?,?,?,?,?)', jobId, userId, state.usage.bucket, 'reserved', clock());
      return get('SELECT * FROM billing_usage WHERE job_id=?', jobId);
    });
  }
  function settleUsage(jobId, outcome) {
    if (!['succeeded', 'failed', 'canceled', 'cancelled'].includes(outcome)) return false;
    return transaction(() => run("UPDATE billing_usage SET state=?,settled_at=? WHERE job_id=? AND state='reserved'", outcome === 'succeeded' ? 'succeeded' : 'released', clock(), jobId).changes > 0);
  }
  function reconcileUsage(jobs) {
    // Called once after the real queue/store recover their job state. Never expire
    // reservations solely because time passed; a running job still owns its slot.
    const states = new Map(jobs.map(job => [job.id, job.status]));
    for (const reservation of all("SELECT job_id FROM billing_usage WHERE state='reserved'")) {
      const state = states.get(reservation.job_id);
      if (['succeeded', 'failed', 'canceled', 'cancelled'].includes(state)) settleUsage(reservation.job_id, state);
      else if (!state) settleUsage(reservation.job_id, 'failed');
    }
  }
  function createOrder({ userId, key, provider, planId, interval, amount, currency, priceId }) {
    return transaction(() => {
      const existing = get('SELECT * FROM billing_orders WHERE user_id=? AND idempotency_key=?', userId, key);
      if (existing) {
        if (existing.provider !== provider || existing.plan_id !== planId || existing.interval !== interval) throw billingError(409, 'IDEMPOTENCY_CONFLICT', 'This checkout request key has already been used for a different plan.');
        return existing;
      }
      const time = clock(), id = randomUUID(), merchantId = provider === 'alipay' ? 'gs_' + id.replaceAll('-', '') : null;
      run('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan_id,interval,amount,currency,price_id,merchant_order_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, userId, key, provider, planId, interval, amount, currency, priceId || null, merchantId, time, time + (provider === 'alipay' ? 15 * 60000 : 24 * 3600000));
      return get('SELECT * FROM billing_orders WHERE user_id=? AND idempotency_key=?', userId, key);
    });
  }
  function publicOrder(order) {
    const subscription = order.subscription_id ? get('SELECT status,cancel_at_period_end FROM billing_subscriptions WHERE id=? AND user_id=?', order.subscription_id, order.user_id) : null;
    return { id: order.id, provider: order.provider, planId: order.plan_id, interval: order.interval, subscriptionId: order.subscription_id || null,
      subscriptionStatus: subscription?.status || null, cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
      amount: order.amount, currency: order.currency, status: order.status, checkoutUrl: order.status === 'pending' && order.expires_at > clock() ? order.checkout_url : null,
      createdAt: new Date(order.created_at).toISOString(), expiresAt: new Date(order.expires_at).toISOString(), paidAt: order.paid_at ? new Date(order.paid_at).toISOString() : null };
  }
  function payment(payment) {
    return { id: payment.id, orderId: payment.order_id, provider: payment.provider, planId: payment.plan_id,
      amount: payment.amount, currency: payment.currency, status: payment.status, receiptUrl: payment.receipt_url,
      startsAt: new Date(payment.starts_at).toISOString(), expiresAt: new Date(payment.ends_at).toISOString(), paidAt: new Date(payment.paid_at).toISOString() };
  }
  function ownedOrder(id, userId) {
    const order = get('SELECT * FROM billing_orders WHERE id=? AND user_id=?', id, userId);
    if (!order) throw billingError(404, 'ORDER_NOT_FOUND', 'The payment order was not found.');
    return order;
  }
  function grantPayment({ id, order, subscriptionId = null, startsAt, endsAt, paidAt = clock(), receiptUrl = null }) {
    if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || endsAt <= startsAt) throw billingError(400, 'INVALID_PAYMENT_PERIOD', 'Invalid paid membership period.');
    const blocked = get("SELECT id FROM billing_refunds WHERE payment_id=? AND reason IN ('full_refund','dispute')", id);
    run('INSERT OR IGNORE INTO billing_payments(id,user_id,order_id,provider,subscription_id,plan_id,amount,currency,starts_at,ends_at,status,receipt_url,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, order.user_id, order.id, order.provider, subscriptionId, order.plan_id, order.amount, order.currency, startsAt, endsAt, blocked ? 'refunded' : 'paid', receiptUrl, paidAt);
    // A terminal refund cannot be reversed by an older paid webhook replay.
    run("UPDATE billing_orders SET status=CASE WHEN status='refunded' OR ? THEN 'refunded' ELSE 'paid' END,paid_at=COALESCE(paid_at,?),subscription_id=COALESCE(?,subscription_id),last_synced_at=? WHERE id=?", blocked ? 1 : 0, paidAt, subscriptionId, clock(), order.id);
  }
  function recordRefund({ id, paymentId, amount, full, dispute = false }) {
    run('INSERT OR IGNORE INTO billing_refunds(id,payment_id,amount,reason,created_at) VALUES(?,?,?,?,?)', id, paymentId, amount, dispute ? 'dispute' : full ? 'full_refund' : 'partial_refund', clock());
    if (full || dispute) {
      run("UPDATE billing_payments SET status='refunded' WHERE id=?", paymentId);
      const first = get('SELECT order_id FROM billing_payments WHERE id=?', paymentId);
      if (first) run("UPDATE billing_orders SET status='refunded',last_synced_at=? WHERE id=?", clock(), first.order_id);
    }
  }
  return { db, config, clock, get, all, run, transaction, membership, reserveUsage, settleUsage, reconcileUsage, createOrder, publicOrder, ownedOrder,
    grantPayment, recordRefund, history: userId => all('SELECT * FROM billing_payments WHERE user_id=? ORDER BY paid_at DESC LIMIT 100', userId).map(payment),
    orders: userId => all('SELECT * FROM billing_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100', userId).map(publicOrder) };
}
