import { request } from './api.ts';

export type PaymentProvider = 'stripe' | 'alipay';
export type BillingInterval = 'monthly' | 'yearly';
export type PlanPrice = { amount: number | null; currency: string | null; available: boolean };
export type BillingPlan = { id: string; name: string; monthlyGenerations: number; prices: { interval: BillingInterval; stripe: PlanPrice | null; alipay: PlanPrice | null }[] };
export type BillingPlans = { providers: Record<PaymentProvider, { available: boolean; recurring: boolean }>; plans: BillingPlan[] };
export type Membership = { planId: string; planName: string; provider: PaymentProvider | null; status: string; expiresAt: string | null; cancelAtPeriodEnd: boolean; subscriptionId: string | null;
  monthlyGenerations: number; usage: { bucket: string; used: number; reserved: number; remaining: number; resetsAt: string } };
export type BillingOrder = { id: string; provider: PaymentProvider; planId: string; interval: BillingInterval; amount: number; currency: string; status: string; checkoutUrl: string | null; createdAt: string; expiresAt: string; paidAt: string | null;
  subscriptionId?: string | null; subscriptionStatus?: string | null; cancelAtPeriodEnd?: boolean };
export type BillingPayment = { id: string; orderId: string; provider: PaymentProvider; planId: string; amount: number; currency: string; status: string; receiptUrl: string | null; startsAt: string; expiresAt: string; paidAt: string };
export type BillingHistory = { payments: BillingPayment[]; orders: BillingOrder[] };
export type CheckoutSelection = { provider: PaymentProvider; planId: string; interval: BillingInterval };

export const billingApi = {
  plans: (signal?: AbortSignal) => request<BillingPlans>('/api/billing/plans', { signal }),
  status: (signal?: AbortSignal) => request<Membership>('/api/billing/status', { signal }),
  history: (signal?: AbortSignal) => request<BillingHistory>('/api/billing/history', { signal }),
  order: (id: string, signal?: AbortSignal) => request<BillingOrder>(`/api/billing/orders/${encodeURIComponent(id)}`, { signal }),
  checkout: (selection: CheckoutSelection, key: string) => request<BillingOrder>('/api/billing/checkout', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(selection) }),
  cancel: (id: string) => request<BillingOrder>(`/api/billing/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  cancelOrder: (id: string) => request<BillingOrder>(`/api/billing/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  portal: () => request<{ url: string }>('/api/billing/portal', { method: 'POST' }),
};

/** An API response must never turn a checkout button into an arbitrary redirect. */
export function validBillingRedirect(value: string, kind: 'checkout' | 'portal', provider?: PaymentProvider): boolean {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    if (kind === 'portal') return url.hostname === 'billing.stripe.com';
    if (provider === 'stripe') return url.hostname === 'checkout.stripe.com';
    return provider === 'alipay' && ['openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com'].includes(url.hostname)
      && url.pathname === '/gateway.do' && url.searchParams.get('method') === 'alipay.trade.page.pay' && url.searchParams.get('sign_type') === 'RSA2';
  } catch { return false; }
}

/** Stripe's charge denomination differs from ISO minor units for ISK and UGX. */
export function billingMoney(amount: number, currency: string, locale: string): string {
  const zeroDecimal = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
  const value = amount / (zeroDecimal.has(currency.toLowerCase()) ? 1 : 100);
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(value); }
  catch { return `${currency.toUpperCase()} ${value.toFixed(2)}`; }
}

export function billingReturnOrder(search: string, hash: string): string | null {
  const candidate = new URLSearchParams(search).get('order') || new URLSearchParams(hash.split('?')[1] || '').get('order');
  return candidate && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidate) ? candidate : null;
}
