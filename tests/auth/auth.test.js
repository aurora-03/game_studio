import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { GoogleProvider } from '../../server/auth/providers.js';

const origin = 'https://studio.example';
const env = { GAMESTUDIO_MODE: 'production', GAMESTUDIO_PUBLIC_URL: origin, GAMESTUDIO_SESSION_SECRET: '4af1f0a9257d61a97d5084818af266708d304beb329af731b5e347c244204a8c3', GAMESTUDIO_PROXY_HOPS: '1', TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'provider-fixture-secret', TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`, GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-google-secret' };
const html = '<!doctype html><html><head><title>Owned game</title></head><body><button>Play</button><canvas></canvas><script>let score=0;function play(){score++;}</script></body></html>';
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function nativeFetch(url, options) {
  const encoded = options.body instanceof FormData ? new Request(url, { method: options.method, body: options.body }) : null;
  const payload = encoded ? Buffer.from(await encoded.arrayBuffer()) : options.body;
  return new Promise((resolve, reject) => { const req = http.request(url, { method: options.method, headers: { ...options.headers, ...(encoded ? { 'Content-Type': encoded.headers.get('content-type') } : {}) } }, res => { const headers = new Headers(); for (let i=0;i<res.rawHeaders.length;i+=2) headers.append(res.rawHeaders[i],res.rawHeaders[i+1]); resolve(new Response([204,304].includes(res.statusCode) ? null : Readable.toWeb(res), { status: res.statusCode, headers })); }); req.on('error',reject); req.end(payload); });
}
async function setup(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-auth-')); const requests = [];
  let app, server, base;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, body: options.body?.toString(), headers: options.headers });
    if (String(url).startsWith('https://verify.twilio.com/')) { const body = new URLSearchParams(options.body); return json({ sid: `VE${'3'.repeat(32)}`, service_sid: env.TWILIO_VERIFY_SERVICE_SID, to: body.get('To'), status: String(url).endsWith('Verifications') ? 'pending' : body.get('Code') === '123456' ? 'approved' : 'pending' }); }
    if (extra.fetchImpl) return extra.fetchImpl(url, options);
    throw new Error('Unexpected provider endpoint');
  };
  async function start() { app = createApp({ dataDir: dir, seed: false, env: { ...env, ...extra.env }, authFetch: fetchImpl, ...extra.options }); server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); }); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await app.locals.studio.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await start(); t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  function client() {
    const jar = new Map(); let csrfToken;
    async function request(route, { method = 'GET', body, status = 200, headers = {}, csrf = true, raw = false } = {}) {
      const response = await nativeFetch(base + route, { method, redirect: 'manual', headers: { Host: 'studio.example', 'X-Forwarded-Proto': 'https', Origin: origin, ...(jar.size ? { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ') } : {}), ...(csrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
      for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'), i = pair.indexOf('='); jar.set(pair.slice(0,i), pair.slice(i+1)); }
      if (response.status !== status) assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`);
      if (raw) return response;
      const value = await response.text(); const result = value ? JSON.parse(value) : undefined; if (result?.csrfToken) csrfToken = result.csrfToken; return result;
    }
    async function login(phone = '+14155552671') { await request('/api/auth/session'); await request('/api/auth/phone/send', { method: 'POST', body: { phone } }); return request('/api/auth/phone/verify', { method: 'POST', body: { phone, code: '123456' } }); }
    return { request, login, jar };
  }
  return { client, requests, dir, get app() { return app; }, async restart() { await stop(); await start(); } };
}

test('production refuses insecure origin, missing/random-short secrets and invalid proxy settings', () => {
  for (const overrides of [{ GAMESTUDIO_PUBLIC_URL: '' }, { GAMESTUDIO_PUBLIC_URL: 'http://studio.example' }, { GAMESTUDIO_PUBLIC_URL: 'https://studio.example/path' }, { GAMESTUDIO_SESSION_SECRET: '' }, { GAMESTUDIO_SESSION_SECRET: 'replace-this-placeholder-xxxxxxxxxxx' }, { GAMESTUDIO_PROXY_HOPS: 'true' }]) assert.throws(() => loadConfig({ ...env, ...overrides }));
  assert.equal(loadConfig(env).production, true); assert.equal(loadConfig({}).mode, 'local');
});

test('anonymous public examples are readonly; private health details and all tenant routes require authentication', async t => {
  const s = await setup(t), c = s.client();
  const health = await c.request('/api/health'); assert.deepEqual(health, { ok: true, mode: 'production', model: 'gpt-6.1-sol' });
  const publicData = await c.request('/api/public/bootstrap'); assert.ok(publicData.projects.length); assert.ok(publicData.projects.every(p => p.demo));
  const demo = publicData.projects[0]; const preview = await c.request(demo.versions[0].previewUrl, { raw: true }); assert.match(await preview.text(), /<html/);
  for (const route of ['/api/bootstrap','/api/projects','/api/settings','/api/jobs','/api/events',`/api/projects/${demo.id}`,`/api/projects/${demo.id}/export`]) await c.request(route, { status: 401 });
  await c.request('/api/projects', { method: 'POST', body: { name: 'Unauthorized' }, status: 401 });
  await c.request('/api/health', { headers: { Host: 'attacker.example' }, status: 403 });
  await c.request('/api/health', { headers: { 'X-Forwarded-Proto': 'http' }, status: 403 });
  await c.request('/api/auth/session', { headers: { Origin: 'https://attacker.example' }, status: 403 });
});

test('phone authentication verifies provider proof, rejects CSRF/replay and sets only hashed secure session cookies', async t => {
  const s = await setup(t), c = s.client(), phone = '+14155552671';
  const session = await c.request('/api/auth/session', { raw: true }); const cookie = session.headers.get('set-cookie'); assert.match(cookie, /__Host-gs_challenge=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  await c.request('/api/auth/session');
  await c.request('/api/auth/phone/send', { method: 'POST', body: { phone }, csrf: false, status: 403 });
  await c.request('/api/auth/phone/send', { method: 'POST', body: { phone: '14155552671' }, status: 400 });
  await c.request('/api/auth/phone/send', { method: 'POST', body: { phone } });
  await c.request('/api/auth/phone/verify', { method: 'POST', body: { phone, code: '999999' }, status: 401 });
  const login = await c.request('/api/auth/phone/verify', { method: 'POST', body: { phone, code: '123456' } }); assert.equal(login.user.phone, phone); assert.equal(login.user.language, 'en');
  assert.equal(s.requests.length, 3); assert.ok(s.requests.every(r => r.url.startsWith('https://verify.twilio.com/v2/Services/'))); assert.match(s.requests[0].headers.Authorization, /^Basic /);
  const token = c.jar.get('__Host-gs_session'), stored = s.app.locals.auth.db.prepare('SELECT * FROM auth_sessions').get(); assert.ok(token); assert.notEqual(stored.token_hash, token); assert.equal(stored.token_hash, crypto.createHmac('sha256', env.GAMESTUDIO_SESSION_SECRET).update(token).digest('hex'));
  await c.request('/api/auth/phone/verify', { method: 'POST', body: { phone, code: '123456' }, status: 403 });
  await c.request('/api/projects', { method: 'POST', body: { name: 'No csrf' }, csrf: false, status: 403 });
  await c.request('/api/projects', { method: 'POST', body: { name: 'No origin' }, headers: { Origin: '' }, status: 403 });
  await c.request('/api/auth/profile', { method: 'PATCH', body: { language: 'zh', name: 'Test owner' } }); assert.equal((await c.request('/api/auth/session')).user.language, 'zh');
  await c.request('/api/auth/logout', { method: 'POST', status: 204 }); await c.request('/api/projects', { status: 401 });
});

test('phone sends have durable per-number cooldown and attempts never produce fake login when provider is absent', async t => {
  const s = await setup(t), c = s.client(); await c.request('/api/auth/session'); const body = { phone: '+14155552671' };
  await c.request('/api/auth/phone/send', { method: 'POST', body });
  await s.restart(); await c.request('/api/auth/phone/send', { method: 'POST', body, status: 429 }); assert.equal(s.requests.length, 1);
  const absent = await setup(t, { env: { TWILIO_AUTH_TOKEN: '', GOOGLE_CLIENT_SECRET: '' } }), d = absent.client(); const session = await d.request('/api/auth/session'); assert.deepEqual(session.providers, { phone: false, google: false });
  await d.request('/api/auth/phone/send', { method: 'POST', body, status: 503 }); await d.request('/api/auth/google/start', { status: 503 }); assert.equal((await d.request('/api/auth/session')).user, null);
});

test('phone identity/session survive restart while expired sessions fail closed', async t => {
  const s = await setup(t), c = s.client(); const login = await c.login(); const p = await c.request('/api/projects', { method: 'POST', body: { name: 'Persistent owned project' }, status: 201 });
  await s.restart(); assert.equal((await c.request('/api/auth/session')).user.id, login.user.id); assert.equal((await c.request(`/api/projects/${p.id}`)).name, p.name);
  s.app.locals.auth.db.prepare('UPDATE auth_sessions SET expires_at=0').run(); await c.request(`/api/projects/${p.id}`, { status: 401 });
});

test('tenant isolation covers project, job, version, material, export, mutation and per-user settings', async t => {
  const s = await setup(t), a = s.client(), b = s.client(); const au = await a.login('+14155552671'); await b.login('+14155552672');
  const p = await a.request('/api/projects', { method: 'POST', body: { name: 'A secret' }, status: 201 });
  const saved = await a.request(`/api/projects/${p.id}/versions`, { method: 'POST', body: { html, title: 'A private game' }, status: 201 }), v = saved.versions[0];
  const form = new FormData(); form.append('file', new Blob(['private design'], { type: 'text/plain' }), 'secret.txt'); const asset = await a.request(`/api/projects/${p.id}/assets`, { method: 'POST', body: form, status: 201 });
  const store = s.app.locals.auth.getUserStore(au.user.id); store.data.jobs.push({ id: 'private-job', projectId: p.id, status: 'failed' }); store.persist();
  await a.request('/api/settings', { method: 'PATCH', body: { language: 'zh-CN' } }); assert.notEqual((await b.request('/api/settings')).language, 'zh-CN');
  for (const route of [`/api/projects/${p.id}`,`/api/projects/${p.id}/versions`,v.previewUrl,`/api/projects/${p.id}/versions/${v.id}`,`/api/projects/${p.id}/export`,asset.url,'/api/jobs/private-job']) await b.request(route, { status: 404 });
  for (const [route,method] of [[`/api/projects/${p.id}/clone`,'POST'],[`/api/projects/${p.id}`,'DELETE'],[`/api/projects/${p.id}/versions/${v.id}/activate`,'POST'],['/api/jobs/private-job/cancel','POST']]) await b.request(route, { method, status: 404 });
  assert.equal((await b.request('/api/bootstrap')).projects.length, 0); assert.equal((await b.request('/api/jobs')).jobs.length, 0);
  const library = await a.request('/api/library'); for (const example of library.projects) { assert.match(example.versions[0].previewUrl, /^\/api\/public\/library\//); await a.request(example.versions[0].previewUrl, { raw: true }); }
  const publicData = await a.request('/api/public/bootstrap'), demo = publicData.projects[0]; const copied = await a.request(`/api/library/${demo.id}/clone`, { method: 'POST', status: 201 }); assert.equal(copied.demo, false); assert.ok(copied.versions.length); assert.notEqual(copied.id, demo.id); await b.request(`/api/projects/${copied.id}`, { status: 404 });
});

test('production sandbox preview embeds owned image data and rejects opaque-origin private file requests', async t => {
  const s = await setup(t), c = s.client(); await c.login(); const p = await c.request('/api/projects', { method: 'POST', body: { name: 'Private material' }, status: 201 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'), form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png'); const asset = await c.request(`/api/projects/${p.id}/assets`, { method: 'POST', body: form, status: 201 });
  const saved = await c.request(`/api/projects/${p.id}/versions`, { method: 'POST', body: { html: html.replace('<canvas>', `<img src="${origin}${asset.url}"><canvas>`), title: 'Image game' }, status: 201 });
  const response = await c.request(saved.versions[0].previewUrl, { raw: true }); const content = await response.text(); assert.match(content, /data:image\/png;base64/); assert.ok(!content.includes(asset.url)); assert.ok(!content.includes(`${origin}data:`));
  const csp = response.headers.get('content-security-policy'); assert.match(csp, /img-src data: blob:/); assert.ok(!csp.includes(origin)); assert.match(csp, /sandbox allow-scripts/);
  await c.request(asset.url, { headers: { Origin: 'null' }, status: 403 }); await c.request(asset.url, { status: 200, raw: true });
});

test('Google JWT verification rejects substituted signatures, issuers, audiences, nonce and expiry', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', use: 'sig', alg: 'RS256' };
  const provider = new GoogleProvider({ clientId: 'client', enabled: true }, async () => json({ keys: [jwk] })); const now = Math.floor(Date.now()/1000), claims = { iss: 'https://accounts.google.com', aud: 'client', sub: 'google-user', iat: now, exp: now+3600, nonce: 'expected', email: 'owner@example.com', email_verified: true };
  function token(patch = {}, key = pair.privateKey) { const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString('base64url'), payload = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url'), source = `${head}.${payload}`; return `${source}.${crypto.sign('RSA-SHA256', Buffer.from(source), key).toString('base64url')}`; }
  assert.equal((await provider.validate(token(), 'expected')).googleSub, 'google-user');
  for (const patch of [{ iss: 'https://attacker.example' },{ aud: 'attacker-client' },{ exp: now-1 },{ nonce: 'attacker' },{ iat: now+1000 },{ aud: ['client','other'], azp: 'other' }]) await assert.rejects(provider.validate(token(patch), 'expected'), { status: 401 });
  await assert.rejects(provider.validate(token({}, other.privateKey), 'expected'), { status: 401 });
});

test('Google callback requires bound one-time state, exchanges PKCE, and creates session only after verified identity', async t => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); let nonce, challenge, exchange;
  const s = await setup(t, { fetchImpl: async (url, options) => { if (String(url).includes('/certs')) return json({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'key', use: 'sig', alg: 'RS256' }] }); if (String(url).includes('/token')) { exchange = new URLSearchParams(options.body); const now = Math.floor(Date.now()/1000), source = `${Buffer.from(JSON.stringify({alg:'RS256',kid:'key'})).toString('base64url')}.${Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'google-123',iat:now,exp:now+3600,nonce,email:'owner@example.com',email_verified:true,name:'Google owner'})).toString('base64url')}`; return json({ id_token: `${source}.${crypto.sign('RSA-SHA256',Buffer.from(source),pair.privateKey).toString('base64url')}` }); } throw new Error('Unknown provider'); } });
  const c = s.client(), other = s.client(); const start = await c.request('/api/auth/google/start', { status: 302, raw: true }), location = new URL(start.headers.get('location')), state = location.searchParams.get('state'); nonce = location.searchParams.get('nonce'); challenge = location.searchParams.get('code_challenge');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256'); assert.equal(location.searchParams.get('redirect_uri'), `${origin}/api/auth/google/callback`);
  await other.request(`/api/auth/google/callback?state=${state}&code=fixture`, { status: 400 });
  const browserFailure = await other.request(`/api/auth/google/callback?state=${state}&code=fixture`, { status: 303, raw: true, headers: { Accept: 'text/html,application/xhtml+xml' } }); assert.equal(browserFailure.headers.get('location'), '/?authError=google_failed#login');
  await c.request(`/api/auth/google/callback?state=${state}&code=fixture`, { status: 303, raw: true }); assert.equal(exchange.get('code'), 'fixture'); assert.equal(crypto.createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), challenge); assert.equal((await c.request('/api/auth/session')).user.googleSub, 'google-123');
  await c.request(`/api/auth/google/callback?state=${state}&code=fixture`, { status: 400 });
});

test('SSE is scoped to its owner and logout immediately terminates that session stream', async t => {
  const s = await setup(t), a = s.client(), b = s.client(); await a.login('+14155552671'); await b.login('+14155552672');
  const response = await a.request('/api/events', { raw: true }), reader = response.body.getReader(); const initial = await reader.read(); assert.match(Buffer.from(initial.value).toString(), /connected/);
  await b.request('/api/projects', { method: 'POST', body: { name: 'Other tenant secret' }, status: 201 });
  const own = await a.request('/api/projects', { method: 'POST', body: { name: 'Own tenant' }, status: 201 });
  const update = Buffer.from((await reader.read()).value).toString(); assert.ok(update.includes(own.id)); assert.ok(!update.includes('Other tenant secret'));
  await a.request('/api/auth/logout', { method: 'POST', status: 204 });
  const closed = await Promise.race([reader.read(), wait(1000).then(() => ({ timeout: true }))]); assert.equal(closed.done, true);
});

test('project and actual byte storage limits reject before changing metadata or creating uploaded files', async t => {
  const s = await setup(t, { env: { GAMESTUDIO_MAX_PROJECTS: '1', GAMESTUDIO_MAX_TENANT_BYTES: '1048576' } }), c = s.client(), login = await c.login();
  const p = await c.request('/api/projects', { method: 'POST', body: { name: 'Only project' }, status: 201 });
  await c.request('/api/projects', { method: 'POST', body: { name: 'Second' }, status: 409 }); await c.request(`/api/projects/${p.id}/clone`, { method: 'POST', status: 409 });
  const userStore = s.app.locals.auth.getUserStore(login.user.id), before = userStore.diskBytes(); const form = new FormData(); form.append('file', new Blob([Buffer.alloc(1048576, 'a')], { type: 'text/plain' }), 'over-limit.txt');
  const result = await c.request(`/api/projects/${p.id}/assets`, { method: 'POST', body: form, status: 413 }); assert.equal(result.error, 'STORAGE_LIMIT'); assert.equal(userStore.diskBytes(), before); assert.equal((await c.request(`/api/projects/${p.id}`)).assets.length, 0);
});

test('global worker runs one tenant child at a time, including cancellation until child close, and admission rejects atomically', async t => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-worker-')), script = path.join(fixtureDir, 'worker.mjs'), trace = path.join(fixtureDir, 'trace.jsonl');
  fs.writeFileSync(script, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);let input='';for await(const chunk of process.stdin)input+=chunk;const trace=${JSON.stringify(trace)};fs.appendFileSync(trace,JSON.stringify({event:'start',pid:process.pid,at:Date.now()})+'\\n');if(input.includes('IGNORE_TERM'))process.on('SIGTERM',()=>{});await new Promise(r=>setTimeout(r,input.includes('IGNORE_TERM')?3000:120));const i=args.indexOf('--output-last-message');fs.writeFileSync(args[i+1],JSON.stringify({title:'Worker fixture',summary:'Controlled transport',controls:'Click',html:${JSON.stringify(html)}}));fs.appendFileSync(trace,JSON.stringify({event:'end',pid:process.pid,at:Date.now()})+'\\n');`, { mode: 0o700 });
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  let reserved = [], settled = []; const s = await setup(t, { options: { codexBin: script, healthCheck: async () => ({ available: true, authenticated: true, version: 'fixture' }), installBilling(app) { app.locals.billing = { reserveUsage(user,id) { if (reserved.length >= 2) throw Object.assign(new Error('No credit'), { status: 402, code: 'QUOTA_EXCEEDED' }); reserved.push({ user,id }); }, settleUsage(id,status) { settled.push({id,status}); } }; } } }), a = s.client(), b = s.client(); await a.login('+14155552671'); await b.login('+14155552672');
  const pa = await a.request('/api/projects', { method:'POST', body:{name:'A'},status:201 }), pb = await b.request('/api/projects', { method:'POST',body:{name:'B'},status:201 });
  const ja = await a.request(`/api/projects/${pa.id}/jobs`, {method:'POST',body:{prompt:'IGNORE_TERM create a game',mode:'generate'},status:202});
  const jb = await b.request(`/api/projects/${pb.id}/jobs`, {method:'POST',body:{prompt:'Create another playable game',mode:'generate'},status:202});
  const deadline = Date.now()+3000; while ((!fs.existsSync(trace)||!fs.readFileSync(trace,'utf8').trim()) && Date.now()<deadline) await wait(20); assert.ok(fs.existsSync(trace));
  assert.equal((await b.request(`/api/jobs/${jb.id}`)).status,'queued');
  await a.request(`/api/jobs/${ja.id}/cancel`,{method:'POST'}); await wait(200); assert.equal((await b.request(`/api/jobs/${jb.id}`)).status,'queued');
  const finishDeadline=Date.now()+5000; let completed; do { completed=await b.request(`/api/jobs/${jb.id}`); if(completed.status==='succeeded')break; await wait(25); } while(Date.now()<finishDeadline); assert.equal(completed.status,'succeeded');
  const rows=fs.readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse); assert.equal(rows.filter(r=>r.event==='start').length,2); assert.ok(rows[1].at-rows[0].at>=2400,'second child starts only after cancellation escalation closes first child');
  const before=await a.request(`/api/projects/${pa.id}`); await a.request(`/api/projects/${pa.id}/jobs`,{method:'POST',body:{prompt:'Denied quota game',mode:'generate'},status:402}); const after=await a.request(`/api/projects/${pa.id}`); assert.deepEqual(after,before); assert.equal((await a.request('/api/jobs')).jobs.length,1); assert.ok(settled.some(r=>r.id===ja.id&&r.status==='cancelled'));
});

test('tenant context stays pinned for an asynchronous HTTP mutation and evicts only after response completion', async t => {
  const s=await setup(t,{options:{contextLimit:1}}),a=s.client(),b=s.client(),owner=await a.login('+14155552671');await b.login('+14155552672');const p=await a.request('/api/projects',{method:'POST',body:{name:'Original name'},status:201});const context=s.app.locals.auth.getUserContext(owner.user.id);let entered,release;const didEnter=new Promise(resolve=>{entered=resolve;});
  context.router.post('/api/_fixture/hold',async(req,res)=>{entered();await new Promise(resolve=>{release=resolve;});context.store.getProject(p.id).name='Committed after awaiting';context.store.persist();res.json({ok:true});});
  const pending=a.request('/api/_fixture/hold',{method:'POST',body:{}});await didEnter;assert.equal(context.activeRequests,1);assert.equal(context.streams.size,0);await b.request('/api/projects',{status:503});assert.equal(s.app.locals.auth.getUserContext(owner.user.id),context);release();await pending;assert.equal(context.activeRequests,0);await b.request('/api/projects');assert.equal(context.queue.closed,true);assert.equal((await a.request(`/api/projects/${p.id}`)).name,'Committed after awaiting');
});
