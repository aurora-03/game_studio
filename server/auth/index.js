import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { GoogleProvider, PhoneProvider, authError, normalizePhone } from './providers.js';

const random = () => crypto.randomBytes(32).toString('base64url');
function cookies(req) { const result = {}; for (const pair of (req.headers.cookie || '').split(';')) { const i = pair.indexOf('='); if (i > 0) { try { result[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1)); } catch { /* invalid cookie ignored */ } } } return result; }
const publicUser = user => user ? { id: user.id, phone: user.phone, googleSub: user.google_sub, email: user.email, name: user.name, createdAt: new Date(user.created_at).toISOString(), language: user.language || 'en' } : null;
function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function createAuth(config, { dataDir, fetchImpl = fetch } = {}) {
  const digest = value => crypto.createHmac('sha256', config.sessionSecret || 'local-workspace').update(value).digest('hex');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dataDir, 'identity.sqlite'), db = new DatabaseSync(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,phone TEXT UNIQUE,google_sub TEXT UNIQUE,email TEXT,name TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'en',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf_token TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_challenges(token_hash TEXT PRIMARY KEY,csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL,phone TEXT,phone_sent_at INTEGER);
    CREATE TABLE IF NOT EXISTS auth_oauth(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_rates(key TEXT PRIMARY KEY,count INTEGER NOT NULL,resets_at INTEGER NOT NULL);`);
  const google = new GoogleProvider(config.google, fetchImpl), phone = new PhoneProvider(config.twilio, fetchImpl);
  const names = { session: config.production ? '__Host-gs_session' : 'gs_session', challenge: config.production ? '__Host-gs_challenge' : 'gs_challenge' };
  const listeners = new Set();
  function setCookie(res, name, token, maxAge) { res.append('Set-Cookie', `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${config.production ? '; Secure' : ''}; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`); }
  function cleanup() { const ts = Date.now(); for (const table of ['auth_sessions', 'auth_challenges', 'auth_oauth']) db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(ts); db.prepare('DELETE FROM auth_rates WHERE resets_at<=?').run(ts); }
  cleanup(); const timer = setInterval(cleanup, 600000); timer.unref();
  function rate(key, limit, windowMs) {
    const ts = Date.now(), hashed = digest(key);
    const row = db.prepare('INSERT INTO auth_rates(key,count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resets_at<=? THEN 1 ELSE count+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING count,resets_at').get(hashed, ts + windowMs, ts, ts);
    if (row.count > limit) throw Object.assign(authError(429, 'Too many attempts. Please try again later.', 'RATE_LIMITED'), { retryAfter: Math.max(1, Math.ceil((row.resets_at - ts) / 1000)) });
  }
  function sessionActive(hash) { const row = db.prepare('SELECT expires_at,last_seen FROM auth_sessions WHERE token_hash=?').get(hash); return Boolean(row && row.expires_at > Date.now() && row.last_seen > Date.now() - 86400000); }
  function middleware(req, res, next) {
    const token = cookies(req)[names.session];
    if (token && /^[\w-]{43}$/.test(token)) {
      const hash = digest(token), row = db.prepare('SELECT s.*,u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>?').get(hash, Date.now(), Date.now() - 86400000);
      if (row) { req.user = publicUser(row); req.session = { tokenHash: hash, csrfToken: row.csrf_token, expiresAt: row.expires_at }; if (row.last_seen < Date.now() - 60000) db.prepare('UPDATE auth_sessions SET last_seen=? WHERE token_hash=?').run(Date.now(), hash); }
    }
    next();
  }
  function challenge(req, res) {
    const token = cookies(req)[names.challenge]; let row = token && /^[\w-]{43}$/.test(token) ? db.prepare('SELECT * FROM auth_challenges WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) : null;
    if (!row) {
      const value = random(); row = { token_hash: digest(value), csrf_token: random(), expires_at: Date.now() + 600000 };
      db.prepare('INSERT INTO auth_challenges(token_hash,csrf_token,expires_at) VALUES(?,?,?)').run(row.token_hash, row.csrf_token, row.expires_at); setCookie(res, names.challenge, value, 600000);
    }
    return row;
  }
  function requireUser(req, res, next) { if (!req.user) return next(authError(401, 'Sign in to continue.', 'AUTH_REQUIRED')); next(); }
  function checkOrigin(req) { if (!config.production) return; if (req.headers.origin !== config.publicOrigin) throw authError(403, 'Request origin is not permitted.', 'INVALID_ORIGIN'); }
  function requireCsrf(req, res, next) { try { checkOrigin(req); if (!req.session || !equal(req.headers['x-csrf-token'], req.session.csrfToken)) throw authError(403, 'Refresh this page before retrying.', 'INVALID_CSRF'); next(); } catch (error) { next(error); } }
  function anonymousCsrf(req, res, next) { try { checkOrigin(req); const token = cookies(req)[names.challenge], row = token && /^[\w-]{43}$/.test(token) ? db.prepare('SELECT * FROM auth_challenges WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) : null; if (!row || !equal(req.headers['x-csrf-token'], row.csrf_token)) throw authError(403, 'Refresh the sign-in page before retrying.', 'INVALID_CSRF'); req.authChallenge = row; next(); } catch (error) { next(error); } }
  function userFor(identity) {
    const ts = Date.now(); let user = identity.phone ? db.prepare('SELECT * FROM users WHERE phone=?').get(identity.phone) : db.prepare('SELECT * FROM users WHERE google_sub=?').get(identity.googleSub);
    // Email never links independent identities implicitly; ownership is verified by the actual login provider.
    if (!user) { const id = crypto.randomUUID(); db.prepare('INSERT INTO users(id,phone,google_sub,email,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, identity.phone || null, identity.googleSub || null, identity.email || null, identity.name || (identity.phone ? `User ${identity.phone.slice(-4)}` : 'User'), ts, ts); user = db.prepare('SELECT * FROM users WHERE id=?').get(id); }
    else if (identity.googleSub) { db.prepare('UPDATE users SET email=?,name=?,updated_at=? WHERE id=?').run(identity.email || null, identity.name || user.name, ts, user.id); user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id); }
    return publicUser(user);
  }
  function issueSession(req, res, user) {
    if (req.session) revoke(req.session.tokenHash);
    const token = random(), csrfToken = random(), ts = Date.now();
    db.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen) VALUES(?,?,?,?,?,?)').run(digest(token), user.id, csrfToken, ts, ts + config.sessionLifetimeMs, ts);
    const old = db.prepare('SELECT token_hash FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 5').all(user.id); for (const row of old) revoke(row.token_hash);
    setCookie(res, names.session, token, config.sessionLifetimeMs); return { user, csrfToken };
  }
  function revoke(hash) { db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash); for (const listener of listeners) listener(hash); }
  function installRoutes(app) {
    const json = express.json({ limit: '8kb' });
    app.get('/api/auth/session', (req, res) => { rate(`session-ip:${req.ip}`, 120, 60000); const row = req.user ? null : challenge(req, res); res.json({ mode: config.mode, user: req.user || null, csrfToken: req.session?.csrfToken || row.csrf_token, providers: { phone: config.twilio.enabled, google: config.google.enabled }, sessionExpiresAt: req.session ? new Date(req.session.expiresAt).toISOString() : null }); });
    app.post('/api/auth/phone/send', json, anonymousCsrf, async (req, res, next) => {
      try {
        const number = normalizePhone(req.body?.phone, config.phoneCountries); rate(`send-ip:${req.ip}`, 10, 3600000); rate(`send-phone:${number}`, 5, 3600000); rate(`send-cooldown:${number}`, 1, 60000);
        const row = req.authChallenge; await phone.send(number);
        db.prepare('UPDATE auth_challenges SET phone=?,phone_sent_at=? WHERE token_hash=?').run(number, Date.now(), row.token_hash);
        res.json({ sent: true, retryAfter: 60 });
      } catch (error) { next(error); }
    });
    app.post('/api/auth/phone/verify', json, anonymousCsrf, async (req, res, next) => {
      try {
        const number = normalizePhone(req.body?.phone, config.phoneCountries), row = req.authChallenge;
        rate(`verify-ip:${req.ip}`, 30, 600000); rate(`verify-phone:${number}`, 5, 600000);
        if (row.phone !== number || !row.phone_sent_at || row.phone_sent_at < Date.now() - 600000) throw authError(400, 'Request a new verification code first.', 'VERIFICATION_REQUIRED');
        if (!await phone.check(number, req.body?.code)) throw authError(401, 'The verification code is incorrect or expired.', 'INVALID_CODE');
        // Consume browser verification atomically before creating any login session.
        const consumed = db.prepare('DELETE FROM auth_challenges WHERE token_hash=? AND phone=? RETURNING token_hash').get(row.token_hash, number);
        if (!consumed) throw authError(409, 'This verification has already been used.', 'VERIFICATION_USED');
        const result = issueSession(req, res, userFor({ phone: number })); setCookie(res, names.challenge, '', 0); res.json(result);
      } catch (error) { next(error); }
    });
    app.get('/api/auth/google/start', (req, res, next) => {
      try {
        rate(`google-ip:${req.ip}`, 20, 600000); const row = challenge(req, res), state = random(), verifier = random(), nonce = random();
        const redirectUri = `${config.publicOrigin || `${req.protocol}://${req.get('host')}`}/api/auth/google/callback`;
        const url = google.authorization({ state, nonce, verifier, redirectUri });
        db.prepare('INSERT INTO auth_oauth(state_hash,browser_hash,verifier,nonce,expires_at) VALUES(?,?,?,?,?)').run(digest(state), row.token_hash, verifier, nonce, Date.now() + 600000);
        res.redirect(302, url);
      } catch (error) { next(error); }
    });
    app.get('/api/auth/google/callback', async (req, res, next) => {
      try {
        if (typeof req.query.state !== 'string' || !/^[\w-]{43}$/.test(req.query.state)) throw authError(400, 'Google sign-in state is invalid.', 'INVALID_OAUTH_STATE');
        const browser = cookies(req)[names.challenge];
        if (!browser || !/^[\w-]{43}$/.test(browser)) throw authError(400, 'Google sign-in browser session expired.', 'INVALID_OAUTH_STATE');
        const row = db.prepare('DELETE FROM auth_oauth WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').get(digest(req.query.state), digest(browser), Date.now());
        if (!row) throw authError(400, 'Google sign-in state expired or was already used.', 'INVALID_OAUTH_STATE');
        if (req.query.error) return res.redirect(303, '/?authError=google_cancelled#login');
        const redirectUri = `${config.publicOrigin || `${req.protocol}://${req.get('host')}`}/api/auth/google/callback`;
        const identity = await google.exchange(req.query.code, row.verifier, redirectUri, row.nonce);
        issueSession(req, res, userFor(identity)); db.prepare('DELETE FROM auth_challenges WHERE token_hash=?').run(row.browser_hash); setCookie(res, names.challenge, '', 0); res.redirect(303, '/?authChanged=1#projects');
      } catch (error) {
        const acceptsHtml = (req.get('accept') || '').split(',').some(value => { const [type, ...parameters] = value.trim().toLowerCase().split(';'); const quality = parameters.find(part => part.trim().startsWith('q=')); return type === 'text/html' && (!quality || Number(quality.trim().slice(2)) > 0); });
        if (acceptsHtml) {
          console.warn('[auth] Google callback failed', { code: /^[A-Z0-9_]{1,60}$/.test(error.code || '') ? error.code : 'AUTH_FAILED', status: error.status || 500 });
          return res.redirect(303, '/?authError=google_failed#login');
        }
        next(error);
      }
    });
    app.post('/api/auth/logout', requireUser, requireCsrf, (req, res) => { revoke(req.session.tokenHash); setCookie(res, names.session, '', 0); res.status(204).end(); });
    app.patch('/api/auth/profile', json, requireUser, requireCsrf, (req, res, next) => { try { const { name, language } = req.body || {}; if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) || (language !== undefined && !['en', 'zh'].includes(language))) throw authError(400, 'Invalid profile settings.', 'INVALID_PROFILE'); db.prepare('UPDATE users SET name=?,language=?,updated_at=? WHERE id=?').run(name?.trim() || req.user.name, language || req.user.language, Date.now(), req.user.id); res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))); } catch (error) { next(error); } });
  }
  return { db, config, middleware, requireUser, requireCsrf, installRoutes, sessionActive, onRevoke(listener) { listeners.add(listener); return () => listeners.delete(listener); }, rate, close() { clearInterval(timer); db.close(); } };
}
