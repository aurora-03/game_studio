import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CreditCard, LoaderCircle, Receipt, RefreshCw, Wallet, X } from 'lucide-react';
import type { AuthSession } from '../auth-api.ts';
import { billingApi, billingMoney, billingReturnOrder, validBillingRedirect } from '../billing-api.ts';
import type { BillingHistory, BillingInterval, BillingOrder, BillingPlans, CheckoutSelection, Membership, PaymentProvider } from '../billing-api.ts';
import { localeCode, t, useLanguage } from '../i18n.tsx';
import '../account.css';
import '../billingUI.css';

type Props = { session: AuthSession | null; onSignIn: () => void; notify: (message: string) => void };
type Attempt = CheckoutSelection & { key: string; createdAt: number };
type Owned<T> = { owner: string; data: T };
const providerName = (provider: PaymentProvider) => provider === 'stripe' ? 'Stripe' : 'Alipay';
const terminal = new Set(['paid', 'refunded', 'expired', 'canceled', 'cancelled', 'failed']);
const attemptStorage = (userId: string) => `gamestudio.billing.checkout.${userId}`;
function saveAttempt(userId: string, attempt: Attempt | null) { try { if (attempt) sessionStorage.setItem(attemptStorage(userId), JSON.stringify(attempt)); else sessionStorage.removeItem(attemptStorage(userId)); } catch { /* In-memory retries still keep the original key. */ } }
function readAttempt(userId: string): Attempt | null {
  try { const saved = JSON.parse(sessionStorage.getItem(attemptStorage(userId)) || 'null') as Attempt | null;
    return saved && ['stripe', 'alipay'].includes(saved.provider) && ['monthly', 'yearly'].includes(saved.interval) && ['pro', 'studio'].includes(saved.planId)
      && typeof saved.key === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(saved.key) && Number.isFinite(saved.createdAt) && saved.createdAt <= Date.now() && Date.now() - saved.createdAt < 24 * 3600000 ? saved : null;
  } catch { return null; }
}
function message(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const known: Record<string, string> = {
    AUTH_REQUIRED: 'Sign in again to manage your membership.', INVALID_CSRF: 'Refresh this page before retrying.',
    PAYMENT_PROVIDER_UNAVAILABLE: 'This payment option is currently unavailable.', INVALID_STRIPE_PRICE: 'This plan is currently unavailable.',
    ACTIVE_SUBSCRIPTION_EXISTS: 'Manage your existing Stripe subscription before purchasing another plan.',
    ACTIVE_MEMBERSHIP_EXISTS: 'Plan or payment changes are available after your prepaid membership ends.',
    PENDING_CHECKOUT_EXISTS: 'Complete or cancel your existing checkout before starting another.', CHECKOUT_IN_PROGRESS: 'A checkout request is already being processed. Please wait.',
    ORDER_NOT_FOUND: 'This checkout was not found in your account.', PAYMENT_PROVIDER_ERROR: 'The payment provider could not complete the request. Please retry.',
    PAYMENT_IDENTITY_MISMATCH: 'The payment could not be verified. Please contact support.', PAYMENT_AMOUNT_MISMATCH: 'The payment could not be verified. Please contact support.',
    BILLING_CUSTOMER_NOT_FOUND: 'Your account has no Stripe billing history.', BILLING_CLOSED: 'Billing is temporarily unavailable. Please retry.',
    UNSAFE_PORTAL_CONFIGURATION: 'The billing portal is unavailable. You can still cancel subscription renewal here.',
    PAYMENT_PROCESSING: 'Your payment is still processing. Wait for confirmation, then check this order again.',
  };
  if (known[code]) return t(known[code]);
  return error instanceof Error ? t(error.message) : t('Unable to load billing information. Please retry.');
}
function date(value: string | null, withTime = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(localeCode(), { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' as const, timeZone: 'UTC' } : {}) }).format(new Date(value)) + (withTime ? ' UTC' : '');
}
function stateLabel(status: string) {
  return t(({ pending: 'Awaiting payment', paid: 'Paid', refunded: 'Refunded or suspended', expired: 'Expired', canceled: 'Canceled', cancelled: 'Canceled', failed: 'Failed', active: 'Active', free: 'Free', past_due: 'Renewal payment pending' } as Record<string, string>)[status] || 'Pending');
}
function validReceipt(url: string | null) {
  try { const target = new URL(url || ''); return target.protocol === 'https:' && target.hostname === 'invoice.stripe.com' && !target.username && !target.password && !target.port; } catch { return false; }
}

export function BillingPage({ session, onSignIn, notify }: Props) {
  const { language } = useLanguage();
  const userId = session?.user?.id || '';
  const [plans, setPlans] = useState<BillingPlans | null>(null), [plansError, setPlansError] = useState<unknown>(null);
  const [memberState, setMember] = useState<Owned<Membership> | null>(null), [historyState, setHistory] = useState<Owned<BillingHistory> | null>(null);
  const [orderState, setOrder] = useState<Owned<BillingOrder> | null>(null), [accountError, setAccountError] = useState<unknown>(null);
  const [provider, setProvider] = useState<PaymentProvider>('stripe'), [interval, setInterval] = useState<BillingInterval>('monthly');
  const [busy, setBusy] = useState(''), [actionError, setActionError] = useState<unknown>(null), [confirmCancel, setConfirmCancel] = useState(false);
  const [reload, setReload] = useState(0), [pollKey, setPollKey] = useState(0), [pollState, setPollState] = useState('idle');
  const [returnId, setReturnId] = useState(() => billingReturnOrder(window.location.search, window.location.hash));
  const [attemptState, setAttemptState] = useState<Owned<Attempt> | null>(null);
  const [renewalConfirm, setRenewalConfirm] = useState<Owned<string> | null>(null);
  const attempts = useRef<Owned<Attempt> | null>(null), notified = useRef(new Set<string>()), mounted = useRef(true), currentUser = useRef(userId);
  currentUser.current = userId;
  const notifyRef = useRef(notify); notifyRef.current = notify;
  const member = memberState?.owner === userId ? memberState.data : null;
  const history = historyState?.owner === userId ? historyState.data : null;
  const order = orderState?.owner === userId ? orderState.data : null;
  const attempt = attemptState?.owner === userId ? attemptState.data : null;
  const pendingOrder = order?.status === 'pending';
  const renewableOrder = history?.orders.find(value => value.provider === 'stripe' && value.subscriptionId && !value.cancelAtPeriodEnd
    && (member?.subscriptionId === value.subscriptionId ? !member.cancelAtPeriodEnd : ['active', 'past_due', 'unpaid', 'trialing', 'paused'].includes(value.subscriptionStatus || ''))
    && history.payments.some(payment => payment.provider === 'stripe' && payment.orderId === value.id));
  const linkExpired = Boolean(pendingOrder && Date.parse(order.expiresAt) <= Date.now());
  const plansErrorText = plansError ? message(plansError) : '', accountErrorText = accountError ? message(accountError) : '', actionErrorText = actionError ? message(actionError) : '';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const handler = () => setReturnId(billingReturnOrder(window.location.search, window.location.hash)); window.addEventListener('hashchange', handler); window.addEventListener('popstate', handler); return () => { window.removeEventListener('hashchange', handler); window.removeEventListener('popstate', handler); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setPlansError(null);
    billingApi.plans(controller.signal).then(value => { if (!controller.signal.aborted) setPlans(value); }).catch(error => { if (!controller.signal.aborted) setPlansError(error); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const saved = userId ? readAttempt(userId) : null;
    attempts.current = saved ? { owner: userId, data: saved } : null; setAttemptState(attempts.current); setActionError(null); setAccountError(null); setConfirmCancel(false); setRenewalConfirm(null); setBusy('');
    if (saved) { setProvider(saved.provider); setInterval(saved.interval); }
  }, [userId]);
  useEffect(() => {
    if (!plans || attempt || order) return;
    if (!plans.providers[provider].available) {
      const available = (['stripe', 'alipay'] as const).find(value => plans.providers[value].available);
      if (available) setProvider(available);
    }
  }, [plans, provider, attempt, order]);
  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    if (!userId) return;
    const [membership, records] = await Promise.all([billingApi.status(signal), billingApi.history(signal)]);
    if (signal?.aborted || !mounted.current || currentUser.current !== userId) return;
    setMember({ owner: userId, data: membership }); setHistory({ owner: userId, data: records }); setAccountError(null);
    return records;
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadAccount(controller.signal).then(records => {
      if (!records || controller.signal.aborted) return;
      const target = returnId || records.orders.find(value => value.status === 'pending')?.id;
      if (target) billingApi.order(target, controller.signal).then(value => { if (!controller.signal.aborted) { setOrder({ owner: userId, data: value }); setProvider(value.provider); setInterval(value.interval); } }).catch(error => { if (!controller.signal.aborted) setActionError(error); });
    }).catch(error => { if (!controller.signal.aborted) setAccountError(error); });
    const timer = window.setInterval(() => { void billingApi.status(controller.signal).then(value => { if (!controller.signal.aborted) setMember({ owner: userId, data: value }); }).catch(() => {}); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [userId, returnId, reload, loadAccount]);
  useEffect(() => {
    if (!userId || !order?.id) return;
    const controller = new AbortController(), started = Date.now(), id = order.id;
    let timer = 0, count = 0, errors = 0;
    const check = async () => {
      setPollState('checking');
      try {
        const latest = await billingApi.order(id, controller.signal);
        if (controller.signal.aborted) return;
        setOrder({ owner: userId, data: latest }); errors = 0; setActionError(null);
        if (terminal.has(latest.status)) {
          setPollState('complete');
          attempts.current = null; setAttemptState(null); saveAttempt(userId, null);
          await loadAccount(controller.signal);
          if (latest.status === 'paid' && !notified.current.has(id) && !controller.signal.aborted) { notified.current.add(id); notifyRef.current(t('Payment confirmed. Your membership has been updated.')); }
          return;
        }
        setPollState(Date.now() - started >= 120000 ? 'paused' : 'waiting');
      } catch (error) {
        if (controller.signal.aborted) return;
        errors++; setActionError(error); setPollState(errors >= 3 ? 'paused' : 'waiting');
      }
      if (!controller.signal.aborted && errors < 3 && Date.now() - started < 120000) timer = window.setTimeout(() => { void check(); }, Math.min(10000, 2000 * Math.pow(1.6, count++)));
    };
    void check();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [userId, order?.id, pollKey, loadAccount]);

  async function startCheckout(selection: CheckoutSelection) {
    if (!userId) { onSignIn(); return; }
    if (busy) return;
    setBusy(selection.planId); setActionError(null);
    const old = attempts.current?.owner === userId ? attempts.current.data : null;
    const selected: Attempt = old && old.provider === selection.provider && old.interval === selection.interval && old.planId === selection.planId ? old : { ...selection, key: crypto.randomUUID(), createdAt: Date.now() };
    attempts.current = { owner: userId, data: selected }; setAttemptState(attempts.current); saveAttempt(userId, selected);
    try {
      const created = await billingApi.checkout(selection, selected.key);
      if (!mounted.current || currentUser.current !== userId) return;
      setOrder({ owner: userId, data: created });
      if (created.checkoutUrl) {
        if (!validBillingRedirect(created.checkoutUrl, 'checkout', created.provider)) throw new Error('The payment page could not be verified. Please contact support.');
        window.location.assign(created.checkoutUrl);
      } else {
        setPollKey(value => value + 1);
        if (created.status === 'pending') setActionError(new Error('This checkout link is no longer available. Check its status or cancel it before starting another.'));
      }
    } catch (error) { if (mounted.current && currentUser.current === userId) { setActionError(error); void loadAccount().then(records => { const existing = records?.orders.find(value => value.status === 'pending'); if (existing && mounted.current && currentUser.current === userId) setOrder({ owner: userId, data: existing }); }).catch(() => {}); } }
    finally { if (mounted.current && currentUser.current === userId) setBusy(''); }
  }
  async function openPortal() {
    if (!userId) { onSignIn(); return; } setBusy('portal'); setActionError(null);
    try { const result = await billingApi.portal(); if (!validBillingRedirect(result.url, 'portal')) throw new Error('The billing portal could not be verified. Please contact support.'); if (mounted.current && currentUser.current === userId) window.location.assign(result.url); }
    catch (error) { if (mounted.current && currentUser.current === userId) setActionError(error); } finally { if (mounted.current && currentUser.current === userId) setBusy(''); }
  }
  async function cancelCheckout() {
    if (!userId || !order || order.status !== 'pending' || busy) return; setBusy('cancel'); setActionError(null);
    try { const latest = await billingApi.cancel(order.id); if (!mounted.current || currentUser.current !== userId) return; setOrder({ owner: userId, data: latest }); setConfirmCancel(false); setPollKey(value => value + 1); await loadAccount(); }
    catch (error) { if (mounted.current && currentUser.current === userId) setActionError(error); } finally { if (mounted.current && currentUser.current === userId) setBusy(''); }
  }
  async function cancelRenewal() {
    const selected = renewalConfirm?.owner === userId ? history?.orders.find(value => value.id === renewalConfirm.data) : null;
    if (!userId || !selected || selected.provider !== 'stripe' || !selected.subscriptionId || busy) return;
    setBusy('renewal'); setActionError(null);
    try {
      const updated = await billingApi.cancelOrder(selected.id);
      if (!mounted.current || currentUser.current !== userId) return;
      if (!updated.cancelAtPeriodEnd) throw new Error('Subscription renewal cancellation has not been confirmed. Please refresh and check its status.');
      setRenewalConfirm(null); await loadAccount();
      if (mounted.current && currentUser.current === userId) notifyRef.current(t('Subscription renewal canceled. Your already-paid period keeps its original end date.'));
    } catch (error) { if (mounted.current && currentUser.current === userId) setActionError(error); }
    finally { if (mounted.current && currentUser.current === userId) setBusy(''); }
  }
  const showPortal = Boolean(userId && (member?.provider === 'stripe' || history?.orders.some(value => value.provider === 'stripe')));
  const unavailable = plans && !plans.providers.stripe.available && !plans.providers.alipay.available;

  return <main className="page account-page billing-page" lang={language === 'zh' ? 'zh-CN' : 'en'}>
    <div className="page-title"><div><h1>{t('Membership & billing')}</h1><p>{t('Choose your creative allowance and manage your payments.')}</p></div><button className="button" onClick={() => { setReload(value => value + 1); setPollKey(value => value + 1); }} disabled={Boolean(busy)}><RefreshCw size={14} />{t('Refresh')}</button></div>
    {!userId && <div className="billing-signin"><div><strong>{t('Sign in to manage your membership')}</strong><p>{t('Your plan, generation allowance, and payment history belong to your account.')}</p></div><button className="button primary" onClick={onSignIn}>{t('Sign in')}</button></div>}
    {member && <section className="membership-summary" aria-label={t('Current membership')}>
      <div><span className="billing-eyebrow">{t('Current plan')}</span><strong>{t(member.planName)}</strong><p>{stateLabel(member.status)}</p></div>
      <div className="billing-allowance"><strong>{t('{remaining} of {total} generations remaining', { remaining: member.usage.remaining, total: member.monthlyGenerations })}</strong><p>{t('{used} completed · {reserved} queued or running', { used: member.usage.used, reserved: member.usage.reserved })}</p><div className="quota-meter" role="meter" aria-label={t('Monthly generation allowance')} aria-valuemin={0} aria-valuemax={member.monthlyGenerations || 1} aria-valuenow={Math.min(member.monthlyGenerations, member.usage.used + member.usage.reserved)}><span style={{ width: `${Math.min(100, (member.usage.used + member.usage.reserved) / (member.monthlyGenerations || 1) * 100)}%` }} /></div><p>{t('Resets {date}', { date: date(member.usage.resetsAt, true) })}</p></div>
      <div><strong>{member.provider === 'stripe' ? t(member.cancelAtPeriodEnd ? 'Renewal canceled' : 'Recurring subscription') : member.provider === 'alipay' ? t('Prepaid membership') : t('Free workspace')}</strong><p>{member.expiresAt ? t('Current paid period ends {date}', { date: date(member.expiresAt, true) }) : t('No payment required.')}</p>{member.provider === 'alipay' && <p>{t('Ends automatically. No recurring charge.')}</p>}{showPortal && <button className="button small" onClick={() => void openPortal()} disabled={Boolean(busy) || !plans?.providers.stripe.available}><CreditCard size={14} />{t('Manage Stripe billing')}<ArrowUpRight size={13} /></button>}{member.provider === 'stripe' && renewableOrder && <button className="button small billing-renewal-button" onClick={() => setRenewalConfirm({ owner: userId, data: renewableOrder.id })} disabled={Boolean(busy)}>{t('Cancel subscription renewal')}</button>}</div>
    </section>}
    {renewableOrder && member?.provider !== 'stripe' && <section className="billing-renewal-panel"><div><strong>{t('Stripe subscription renewal')}</strong><p>{t('You can cancel future subscription renewal without opening the billing portal.')}</p></div><button className="button" onClick={() => setRenewalConfirm({ owner: userId, data: renewableOrder.id })} disabled={Boolean(busy)}>{t('Cancel subscription renewal')}</button></section>}
    {renewalConfirm?.owner === userId && <div className="billing-cancel-confirm billing-renewal-confirm" role="alertdialog" aria-label={t('Cancel subscription renewal?')}><strong>{t('Cancel subscription renewal?')}</strong><p>{t('No new subscription period will be charged after the current period ends. Your already-paid access keeps its original end date.')}</p><div><button className="button" onClick={() => setRenewalConfirm(null)} autoFocus disabled={Boolean(busy)}>{t('Keep renewal')}</button><button className="button danger" onClick={() => void cancelRenewal()} disabled={Boolean(busy)}>{busy === 'renewal' ? t('Canceling…') : t('Confirm cancellation')}</button></div></div>}
    {accountErrorText && <div className="account-alert" role="alert">{accountErrorText}<button className="button small" onClick={() => setReload(value => value + 1)}>{t('Retry')}</button></div>}
    {actionErrorText && <div className="account-alert" role="alert">{actionErrorText}<button className="billing-dismiss" aria-label={t('Dismiss notification')} onClick={() => setActionError(null)}><X size={14} /></button></div>}
    {order && <section className={`billing-checkout-panel ${order.status === 'paid' ? 'is-paid' : ''}`} aria-live="polite">
      <div><span className="billing-eyebrow">{t('Checkout status')}</span><h2>{linkExpired ? t('Checkout link expired') : stateLabel(order.status)}</h2><p>{t('{plan} · {interval} · {provider} · {amount}', { plan: t(({ pro: 'Pro', studio: 'Studio', free: 'Free' } as Record<string, string>)[order.planId] || order.planId), interval: t(order.interval === 'yearly' ? 'Yearly' : 'Monthly'), provider: t(providerName(order.provider)), amount: billingMoney(order.amount, order.currency, localeCode()) })}</p>
      {pendingOrder && <p>{t(pollState === 'paused' ? 'Payment confirmation is taking longer. You can check again at any time.' : linkExpired ? 'Check whether payment completed before starting another checkout.' : 'Waiting for the payment provider to confirm your order.')}</p>}
      {order.status === 'paid' && <p>{t('Payment confirmed by the provider. Your account shows the current membership and allowance.')}</p>}
      {['canceled', 'expired', 'refunded'].includes(order.status) && <p>{t('This order no longer grants a new paid membership period.')}</p>}
      <small>{t('Order {id}', { id: order.id.slice(0, 8) })} · {t('Link deadline {date}', { date: date(order.expiresAt, true) })}</small></div>
      <div className="billing-checkout-actions">
        {pollState === 'checking' && <span className="billing-checking"><LoaderCircle size={14} className="billing-spin" />{t('Checking payment…')}</span>}
        <button className="button" onClick={() => setPollKey(value => value + 1)} disabled={Boolean(busy) || pollState === 'checking'}><RefreshCw size={14} />{t('Check now')}</button>
        {pendingOrder && order.checkoutUrl && !linkExpired && validBillingRedirect(order.checkoutUrl, 'checkout', order.provider) && <button className="button primary" onClick={() => window.location.assign(order.checkoutUrl!)} disabled={Boolean(busy)}>{t('Continue checkout')}<ArrowUpRight size={13} /></button>}
        {pendingOrder && !order.checkoutUrl && !linkExpired && attempt?.provider === order.provider && attempt.planId === order.planId && attempt.interval === order.interval && <button className="button primary" onClick={() => void startCheckout({ provider: order.provider, planId: order.planId, interval: order.interval })} disabled={Boolean(busy)}>{t('Retry checkout')}</button>}
        {pendingOrder && <button className="button" onClick={() => setConfirmCancel(true)} disabled={Boolean(busy)}>{t('Cancel checkout')}</button>}
      </div>
      {confirmCancel && pendingOrder && <div className="billing-cancel-confirm" role="alertdialog" aria-label={t('Cancel this checkout?')}><p>{t('Cancel this checkout? Payment already confirmed by the provider will still be recorded.')}</p><div><button className="button" onClick={() => setConfirmCancel(false)}>{t('Keep checkout')}</button><button className="button danger" onClick={() => void cancelCheckout()} disabled={Boolean(busy)}>{busy === 'cancel' ? t('Canceling…') : t('Cancel checkout')}</button></div></div>}
    </section>}
    <div className="billing-controls"><div className="billing-intervals" role="group" aria-label={t('Billing interval')}><button type="button" aria-pressed={interval === 'monthly'} onClick={() => setInterval('monthly')} disabled={Boolean(busy) || Boolean(pendingOrder)}>{t('Monthly')}</button><button type="button" aria-pressed={interval === 'yearly'} onClick={() => setInterval('yearly')} disabled={Boolean(busy) || Boolean(pendingOrder)}>{t('Yearly')}</button></div>
      <label className="billing-provider-select">{t('Pay with')}<select value={provider} onChange={event => setProvider(event.target.value as PaymentProvider)} disabled={Boolean(busy) || Boolean(pendingOrder)}><option value="stripe" disabled={!plans?.providers.stripe.available}>Stripe{plans?.providers.stripe.available === false ? ` · ${t('Unavailable')}` : ''}</option><option value="alipay" disabled={!plans?.providers.alipay.available}>{t('Alipay')}{plans?.providers.alipay.available === false ? ` · ${t('Unavailable')}` : ''}</option></select></label>
      <span className="billing-payment-note">{provider === 'stripe' ? t('Recurring monthly or yearly billing.') : t('One-time payment for a fixed membership period.')}</span>
    </div>
    {unavailable && <p className="billing-unavailable" role="status">{t('Paid plans are currently unavailable. The free workspace remains available.')}</p>}
    {plansErrorText && <div className="account-alert" role="alert">{plansErrorText}<button className="button small" onClick={() => setReload(value => value + 1)}>{t('Retry')}</button></div>}
    {!plans && !plansErrorText && <div className="billing-loading" role="status"><LoaderCircle size={18} className="billing-spin" />{t('Loading plans…')}</div>}
    {plans && <div className="plan-grid">{plans.plans.map(plan => {
      const free = plan.id === 'free', current = member?.planId === plan.id, chosen = plan.prices.find(value => value.interval === interval)?.[provider];
      const available = Boolean(chosen?.available && chosen.amount !== null && chosen.currency && plans.providers[provider].available);
      const renew = current && member.provider === 'alipay' && provider === 'alipay';
      const locked = Boolean(member?.provider && !renew);
      const retry = attempt?.provider === provider && attempt.interval === interval && attempt.planId === plan.id;
      const disabled = Boolean(busy || pendingOrder || (!free && (!available || (userId && locked))));
      return <article key={plan.id} className={`plan-card ${current ? 'current' : ''}`}>
        <div className="billing-plan-header"><h2>{t(plan.name)}</h2>{current && <span><Check size={12} />{t('Current plan')}</span>}</div>
        <div className="plan-price">{free ? t('Free') : available ? billingMoney(chosen!.amount!, chosen!.currency!, localeCode()) : <span className="billing-price-unavailable">{t('Unavailable')}</span>}{!free && available && <small> / {t(interval === 'yearly' ? 'year' : 'month')}</small>}</div>
        <p className="billing-plan-description">{t(plan.id === 'free' ? 'A workspace for your first playable ideas.' : plan.id === 'pro' ? 'More room to generate and refine your games.' : 'A larger allowance for frequent game creation.')}</p>
        <ul><li>{t('{count} successful generations per month', { count: plan.monthlyGenerations })}</li><li>{t('Characters, scenes, props, and audio workflows')}</li><li>{t('Playable previews and HTML / ZIP export')}</li><li>{t('Failed or canceled generations return their allowance')}</li></ul>
        <p className="billing-plan-period">{free ? t('No payment required.') : provider === 'alipay' ? t('Prepaid. Ends automatically with no recurring charge.') : t(interval === 'yearly' ? 'Billed yearly. The generation allowance resets monthly.' : 'Billed monthly. Cancel renewal in the billing portal.')}</p>
        <button className={`button ${!current || renew ? 'primary' : ''}`} disabled={free ? Boolean(current || userId) : disabled} onClick={() => free ? onSignIn() : void startCheckout({ provider, planId: plan.id, interval })}>{busy === plan.id ? <LoaderCircle size={14} className="billing-spin" /> : free ? <Check size={14} /> : provider === 'stripe' ? <CreditCard size={14} /> : <Wallet size={14} />}{t(free ? current ? 'Current plan' : userId ? 'Included workspace' : 'Start free' : !available ? 'Unavailable' : renew ? 'Extend membership' : current ? 'Current plan' : retry ? 'Retry checkout' : userId ? 'Choose {plan}' : 'Sign in to choose {plan}', { plan: t(plan.name) })}</button>
      </article>;
    })}</div>}
    {member?.provider && <p className="billing-policy">{t(member.provider === 'stripe' ? 'Use the billing portal to manage payment methods, invoices, and subscription renewal.' : 'Your prepaid membership keeps its current plan until it ends. You can extend the same plan with Alipay.')}</p>}
    {userId && <section className="billing-history-section"><div className="billing-history-heading"><h2><Receipt size={17} />{t('Payment history')}</h2>{showPortal && !member?.provider && <button className="button small" onClick={() => void openPortal()} disabled={Boolean(busy) || !plans?.providers.stripe.available}>{t('Manage Stripe billing')}<ArrowUpRight size={13} /></button>}</div>
      {!history && !accountError ? <p className="billing-empty">{t('Loading payment history…')}</p> : history?.payments.length ? <div className="billing-history-scroll"><table className="billing-history"><thead><tr><th>{t('Date')}</th><th>{t('Plan')}</th><th>{t('Payment')}</th><th>{t('Status')}</th><th>{t('Paid period')}</th><th>{t('Receipt')}</th></tr></thead><tbody>{history.payments.map(payment => <tr key={payment.id}><td>{date(payment.paidAt)}</td><td>{t(({ pro: 'Pro', studio: 'Studio' } as Record<string, string>)[payment.planId] || payment.planId)}</td><td>{billingMoney(payment.amount, payment.currency, localeCode())}<small>{t(providerName(payment.provider))}</small></td><td><span className={`billing-status ${payment.status}`}>{stateLabel(payment.status)}</span></td><td>{date(payment.startsAt)} — {date(payment.expiresAt)}</td><td>{validReceipt(payment.receiptUrl) ? <a href={payment.receiptUrl!} target="_blank" rel="noopener noreferrer">{t('View receipt')}<ArrowUpRight size={12} /></a> : '—'}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><Receipt size={22} /><p>{t('Your confirmed payments will appear here.')}</p></div>}
      {Boolean(history?.orders.length) && <details className="billing-orders"><summary>{t('Checkout history')}</summary><ul>{history!.orders.map(value => <li key={value.id}><div><strong>{t(providerName(value.provider))} · {billingMoney(value.amount, value.currency, localeCode())}</strong><small>{t('Order {id}', { id: value.id.slice(0, 8) })} · {date(value.createdAt)}</small></div><span className="billing-status">{stateLabel(value.status)}</span><button className="button small" onClick={() => { setOrder({ owner: userId, data: value }); setPollKey(number => number + 1); setConfirmCancel(false); }} disabled={Boolean(busy)}>{t('View status')}</button></li>)}</ul></details>}
    </section>}
  </main>;
}
