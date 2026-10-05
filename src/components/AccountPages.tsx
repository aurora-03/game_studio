import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleUserRound, Globe2, LoaderCircle, LogOut, Phone, ShieldCheck } from 'lucide-react';
import { getSession, logout, sendPhoneCode, updateProfile, verifyPhoneCode } from '../auth-api';
import type { AuthSession, User } from '../auth-api';
import { t, useLanguage } from '../i18n';
import '../account-ui.css';

const internationalPhone = (input: string) => input.trim().replace(/[\s()-]/g, '');
const validPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
function cooldownFrom(error: unknown): number {
  const value = (error as { retryAfter?: unknown } | null)?.retryAfter;
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
}
function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.258c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.712H.957v2.332A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.042l3.007-2.332Z" />
    <path fill="#EA4335" d="M9 3.578c1.321 0 2.507.454 3.44 1.346l2.581-2.581C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.958L3.964 7.29C4.672 5.162 6.656 3.578 9 3.578Z" />
  </svg>;
}
function PendingLabel({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return <>{pending && <LoaderCircle size={16} className="account-spinner" aria-hidden="true" />}{children}</>;
}

export function LoginPage({ session, onSignedIn, notify, onBack }: {
  session: AuthSession;
  onSignedIn: (session: AuthSession) => void | Promise<void>;
  notify: (message: string) => void;
  onBack: () => void;
}) {
  useLanguage();
  const [phoneInput, setPhoneInput] = useState(''), [code, setCode] = useState(''), [sentPhone, setSentPhone] = useState<string | null>(null);
  const [sending, setSending] = useState(false), [verifying, setVerifying] = useState(false), [googlePending, setGooglePending] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false), [error, setError] = useState(''), [cooldownEnd, setCooldownEnd] = useState(0), [verifyCooldownEnd, setVerifyCooldownEnd] = useState(0), [now, setNow] = useState(Date.now());
  const phoneRef = useRef<HTMLInputElement>(null), codeRef = useRef<HTMLInputElement>(null);
  const phone = internationalPhone(phoneInput), pending = sending || verifying || googlePending, remaining = Math.max(0, Math.ceil((cooldownEnd - now) / 1000)), verifyRemaining = Math.max(0, Math.ceil((verifyCooldownEnd - now) / 1000));
  const phoneError = phoneTouched && phoneInput && !validPhone(phone) ? 'Use an international phone number, such as +14155552671.' : '';
  useEffect(() => {
    if (!cooldownEnd && !verifyCooldownEnd) return;
    const timer = window.setInterval(() => { const time = Date.now(); setNow(time); if (cooldownEnd && time >= cooldownEnd) setCooldownEnd(0); if (verifyCooldownEnd && time >= verifyCooldownEnd) setVerifyCooldownEnd(0); }, 500);
    return () => window.clearInterval(timer);
  }, [cooldownEnd, verifyCooldownEnd]);
  useEffect(() => { if (sentPhone) codeRef.current?.focus(); }, [sentPhone]);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('authError');
    if (!code) return;
    setError(code === 'google_cancelled' ? 'Google sign-in was cancelled. You can try again or use your phone.' : 'Google sign-in could not be completed. Please try again.');
    const clean = new URL(window.location.href); clean.searchParams.delete('authError'); window.history.replaceState(window.history.state, '', clean);
  }, []);
  const startCooldown = (seconds: number) => { const time = Date.now(); setNow(time); setCooldownEnd(time + Math.max(1, seconds) * 1000); };
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (pending || remaining || !session.providers.phone) return;
    setPhoneTouched(true);
    if (!validPhone(phone)) { phoneRef.current?.focus(); return; }
    setSending(true); setError('');
    try {
      const result = await sendPhoneCode(phone); startCooldown(result.retryAfter || 60); setSentPhone(phone); setCode(''); codeRef.current?.focus();
    } catch (error) { setError(errorMessage(error)); const retryAfter = cooldownFrom(error); if (retryAfter) startCooldown(retryAfter); }
    finally { setSending(false); }
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault(); if (pending || verifyRemaining || !session.providers.phone || !sentPhone || sentPhone !== phone) return;
    if (!/^\d{6}$/.test(code)) { setError('Enter the six-digit verification code.'); codeRef.current?.focus(); return; }
    setVerifying(true); setError('');
    try {
      const result = await verifyPhoneCode(sentPhone, code);
      // The verified response itself proves login. A second network interruption
      // must not turn a successful verification into a request to reuse the OTP.
      const current = await getSession().catch(() => ({ ...session, ...result, sessionExpiresAt: null }));
      await onSignedIn(current); notify(t('Signed in successfully.'));
    } catch (error) { setError(errorMessage(error)); const retryAfter = cooldownFrom(error); if (retryAfter) { setNow(Date.now()); setVerifyCooldownEnd(Date.now() + retryAfter * 1000); } }
    finally { setVerifying(false); }
  };
  return <div className="page account-page login-page">
    <button type="button" className="account-back" onClick={onBack} disabled={pending}><ArrowLeft size={16} />{t('Back to browsing')}</button>
    <section className="account-panel login-panel" aria-labelledby="login-title">
      <div className="account-symbol"><CircleUserRound size={23} strokeWidth={1.5} /></div>
      <h1 id="login-title">{t('Sign in to GameStudio')}</h1>
      <p className="account-intro">{t('Keep your projects, materials and membership in one account.')}</p>
      {session.mode === 'local' && <p className="account-notice">{t('You are using a local workspace. Your existing projects remain on this device.')}</p>}
      {error && <p className="account-error" role="alert">{t(error)}</p>}
      <button type="button" className="account-google" disabled={!session.providers.google || pending} onClick={() => { setGooglePending(true); setError(''); window.location.assign('/api/auth/google/start'); }}>
        {googlePending ? <LoaderCircle size={18} className="account-spinner" /> : <GoogleMark />}{t('Continue with Google')}
      </button>
      {!session.providers.google && <p className="account-provider-note">{t('Google sign-in is not available yet.')}</p>}
      <div className="account-divider"><span>{t('or use your phone')}</span></div>
      <form onSubmit={send} className="account-form" aria-busy={sending}>
        <label htmlFor="login-phone">{t('Phone number')}</label>
        <div className="account-phone-row"><div className="account-phone-field"><Phone size={16} aria-hidden="true" /><input ref={phoneRef} id="login-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+14155552671" maxLength={30} value={phoneInput} disabled={!session.providers.phone || pending} aria-describedby="phone-hint phone-validation" aria-invalid={Boolean(phoneError)} onBlur={() => setPhoneTouched(true)} onChange={event => { setPhoneInput(event.target.value); setSentPhone(null); setCode(''); setError(''); }} /></div>
          <button type="submit" className="button" disabled={!session.providers.phone || pending || remaining > 0 || !validPhone(phone)}><PendingLabel pending={sending}>{remaining ? t('Retry in {0}s', { '0': remaining }) : sentPhone ? t('Resend code') : t('Send code')}</PendingLabel></button></div>
        <p id="phone-hint" className="account-hint">{t('Include your country code. We will send you a verification code.')}</p>
        <p id="phone-validation" className="account-field-error" role={phoneError ? 'alert' : undefined}>{phoneError && t(phoneError)}</p>
      </form>
      {!session.providers.phone && <p className="account-provider-note">{t('Phone sign-in is not available yet.')}</p>}
      {sentPhone && <form className="account-form account-code-form" onSubmit={verify} aria-busy={verifying}>
        <label htmlFor="login-code">{t('Verification code')}</label>
        <input ref={codeRef} id="login-code" className="account-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={pending} placeholder="000000" aria-describedby="code-hint" onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} />
        <p id="code-hint" className="account-hint">{t('Code sent to {0}.', { '0': sentPhone })}</p>
        <button type="submit" className="button primary account-submit" disabled={pending || verifyRemaining > 0 || code.length !== 6}><PendingLabel pending={verifying}>{verifying ? t('Signing in…') : verifyRemaining ? t('Retry in {0}s', { '0': verifyRemaining }) : t('Sign in')}</PendingLabel>{!verifying && <ArrowRight size={16} />}</button>
      </form>}
      <p className="account-privacy"><ShieldCheck size={15} strokeWidth={1.5} />{t('Your projects and materials are private to your account.')}</p>
    </section>
  </div>;
}

export function AccountPage({ session, onUserChange, onSignedOut, notify }: {
  session: AuthSession;
  onUserChange: (user: User) => void | Promise<void>;
  onSignedOut: () => void | Promise<void>;
  notify: (message: string) => void;
}) {
  const { language, setLanguage } = useLanguage(), user = session.user;
  const [name, setName] = useState(user?.name || ''), [preferredLanguage, setPreferredLanguage] = useState<User['language']>(user?.language || language), [saving, setSaving] = useState(false), [signingOut, setSigningOut] = useState(false), [error, setError] = useState('');
  useEffect(() => { setName(user?.name || ''); setPreferredLanguage(user?.language || 'en'); setError(''); }, [user?.id, user?.name, user?.language]);
  if (!user) return <div className="page account-page"><section className="account-panel"><h1>{t('Your account')}</h1><p>{t('Sign in to manage your account.')}</p></section></div>;
  const busy = saving || signingOut, changed = name.trim() !== user.name || preferredLanguage !== user.language;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (!name.trim() || name.trim().length > 100) { setError('Enter a name between 1 and 100 characters.'); return; }
    setSaving(true); setError('');
    try { const updated = await updateProfile({ name: name.trim(), language: preferredLanguage }); await onUserChange(updated); setLanguage(updated.language); notify(t('Account settings saved.')); }
    catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  };
  const signOut = async () => {
    if (busy) return; setSigningOut(true); setError('');
    try { await logout(); await onSignedOut(); notify(t('Signed out.')); } catch (error) { setError(errorMessage(error)); } finally { setSigningOut(false); }
  };
  return <div className="page account-page profile-page">
    <div className="page-title"><div><h1>{t('Your account')}</h1><p>{t('Manage your profile, language and sign-in session.')}</p></div></div>
    <section className="account-panel profile-panel" aria-labelledby="profile-title">
      <div className="account-profile-heading"><div className="account-symbol"><CircleUserRound size={24} strokeWidth={1.5} /></div><div><h2 id="profile-title">{t('Profile')}</h2><p>{user.email || user.phone || user.name}</p></div></div>
      {error && <p className="account-error" role="alert">{t(error)}</p>}
      <form className="account-form" onSubmit={save} aria-busy={saving}>
        <label htmlFor="account-name">{t('Display name')}</label><input id="account-name" autoComplete="nickname" maxLength={100} required value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        <label htmlFor="account-language">{t('Preferred language')}</label><div className="account-language-row"><Globe2 size={17} strokeWidth={1.5} /><select id="account-language" value={preferredLanguage} disabled={busy} onChange={event => setPreferredLanguage(event.target.value as User['language'])}><option value="en">English</option><option value="zh">简体中文</option></select></div>
        <p className="account-hint">{t('Your preference is saved to your account and applies when you sign in.')}</p>
        <button type="submit" className="button primary" disabled={busy || !changed || !name.trim()}><PendingLabel pending={saving}>{saving ? t('Saving…') : t('Save changes')}</PendingLabel>{!saving && <Check size={15} />}</button>
      </form>
    </section>
    <section className="account-panel account-security" aria-labelledby="security-title">
      <h2 id="security-title">{t('Sign-in and security')}</h2>
      <dl><div><dt>{t('Sign-in method')}</dt><dd>{user.googleSub ? t('Google') : t('Phone verification')}</dd></div>{user.phone && <div><dt>{t('Phone number')}</dt><dd>{user.phone}</dd></div>}{user.email && <div><dt>{t('Email')}</dt><dd>{user.email}</dd></div>}<div><dt>{t('Member since')}</dt><dd>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium' }).format(new Date(user.createdAt))}</dd></div>{session.sessionExpiresAt && <div><dt>{t('Session expires')}</dt><dd>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.sessionExpiresAt))}</dd></div>}</dl>
      <p className="account-hint">{t('Signing out closes this device’s session and its live project connection.')}</p><button type="button" className="button" disabled={busy} onClick={() => void signOut()}><PendingLabel pending={signingOut}><LogOut size={16} />{signingOut ? t('Signing out…') : t('Sign out')}</PendingLabel></button>
    </section>
  </div>;
}
