import { request, setCsrfToken } from './api';
export function publishAuthChange() {
  try { localStorage.setItem('gamestudio.auth.version', crypto.randomUUID()); } catch { /* Per-tab refresh still works. */ }
}

export type User = {
  id: string;
  phone: string | null;
  googleSub: string | null;
  email: string | null;
  name: string;
  createdAt: string;
  language: 'en' | 'zh';
};
export type AuthSession = {
  mode: 'local' | 'production';
  user: User | null;
  csrfToken: string;
  providers: { phone: boolean; google: boolean };
  sessionExpiresAt: string | null;
};
export type SignInResult = { user: User; csrfToken: string };

export async function getSession(): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/session');
  setCsrfToken(session.csrfToken);
  return session;
}
export function sendPhoneCode(phone: string): Promise<{ sent: true; retryAfter: number }> {
  return request('/api/auth/phone/send', { method: 'POST', body: JSON.stringify({ phone }) });
}
export async function verifyPhoneCode(phone: string, code: string): Promise<SignInResult> {
  const result = await request<SignInResult>('/api/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
  setCsrfToken(result.csrfToken);
  publishAuthChange();
  return result;
}
export function updateProfile(profile: { name?: string; language?: User['language'] }): Promise<User> {
  return request('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(profile) });
}
export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' });
  setCsrfToken(null);
  publishAuthChange();
}
