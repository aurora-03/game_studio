import crypto from 'node:crypto';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export function authError(status, message, code = 'AUTH_FAILED') { return Object.assign(new Error(message), { status, code }); }
export function normalizePhone(value, countries = []) {
  if (typeof value !== 'string' || !/^\+[1-9]\d{7,14}$/.test(value)) throw authError(400, 'Enter a phone number in international format, such as +14155552671.', 'INVALID_PHONE');
  if (countries.length && !countries.some(prefix => value.startsWith(prefix))) throw authError(400, 'This phone country is not supported.', 'PHONE_COUNTRY_NOT_SUPPORTED');
  return value;
}
async function jsonRequest(fetchImpl, url, options) {
  try {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000), redirect: 'error' });
    const json = await response.json();
    if (!response.ok) throw authError(response.status === 429 ? 429 : 502, 'Authentication provider could not complete this request. Please retry.', 'AUTH_PROVIDER_FAILED');
    return { json, response };
  } catch (error) { if (error.status) throw error; throw authError(502, 'Authentication provider is temporarily unavailable.', 'AUTH_PROVIDER_FAILED'); }
}
export class PhoneProvider {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; }
  async request(kind, phone, code) {
    if (!this.config.enabled) throw authError(503, 'Phone login is not configured.', 'AUTH_PROVIDER_NOT_CONFIGURED');
    const body = new URLSearchParams(kind === 'Verifications' ? { To: phone, Channel: 'sms' } : { To: phone, Code: code });
    const { json } = await jsonRequest(this.fetch, `https://verify.twilio.com/v2/Services/${this.config.serviceSid}/${kind}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (json.to !== phone || json.service_sid !== this.config.serviceSid) throw authError(502, 'Authentication provider returned an unexpected verification.', 'AUTH_PROVIDER_FAILED');
    return json;
  }
  async send(phone) { const result = await this.request('Verifications', phone); if (result.status !== 'pending') throw authError(502, 'Unable to send the verification code.', 'AUTH_PROVIDER_FAILED'); return result.sid; }
  async check(phone, code) { if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) throw authError(400, 'Enter the verification code.', 'INVALID_CODE'); return (await this.request('VerificationCheck', phone, code)).status === 'approved'; }
}
export class GoogleProvider {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; this.cached = null; }
  authorization({ state, nonce, verifier, redirectUri }) {
    if (!this.config.enabled) throw authError(503, 'Google login is not configured.', 'AUTH_PROVIDER_NOT_CONFIGURED');
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: this.config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account' })}`;
  }
  async keys(force = false) {
    if (!force && this.cached?.until > Date.now()) return this.cached.keys;
    const { json, response } = await jsonRequest(this.fetch, GOOGLE_JWKS, {});
    if (!Array.isArray(json.keys) || json.keys.length > 50) throw authError(502, 'Invalid Google signing keys.', 'AUTH_PROVIDER_FAILED');
    const maxAge = Math.min(86400, Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 300));
    this.cached = { keys: json.keys, until: Date.now() + maxAge * 1000 }; return json.keys;
  }
  async validate(idToken, nonce) {
    if (typeof idToken !== 'string' || idToken.length > 20000) throw authError(401, 'Invalid Google identity token.', 'INVALID_GOOGLE_TOKEN');
    const parts = idToken.split('.'); let header, claims;
    try { if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error(); header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw authError(401, 'Invalid Google identity token.', 'INVALID_GOOGLE_TOKEN'); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw authError(401, 'Invalid Google signature algorithm.', 'INVALID_GOOGLE_TOKEN');
    let key = (await this.keys()).find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
    if (!key) key = (await this.keys(true)).find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
    let valid = false; try { valid = key && crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')); } catch { /* reject invalid key/token */ }
    const ts = Math.floor(Date.now() / 1000), audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!valid || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || !audiences.includes(this.config.clientId) || (audiences.length > 1 && claims.azp !== this.config.clientId) || (claims.azp && claims.azp !== this.config.clientId) || !Number.isInteger(claims.exp) || claims.exp <= ts || !Number.isInteger(claims.iat) || claims.iat > ts + 60 || claims.iat < ts - 86400 || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || claims.nonce !== nonce) throw authError(401, 'Google identity verification failed.', 'INVALID_GOOGLE_TOKEN');
    return { googleSub: claims.sub, email: claims.email_verified === true && typeof claims.email === 'string' ? claims.email.slice(0, 254) : null, name: typeof claims.name === 'string' ? claims.name.slice(0, 100) : 'Google user' };
  }
  async exchange(code, verifier, redirectUri, nonce) {
    if (typeof code !== 'string' || code.length > 4096) throw authError(400, 'Invalid Google authorization code.');
    const { json } = await jsonRequest(this.fetch, GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
    return this.validate(json.id_token, nonce);
  }
}
