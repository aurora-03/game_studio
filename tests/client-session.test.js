import test from 'node:test';
import assert from 'node:assert/strict';
import { request, resetSessionRequests, setCsrfToken, sessionRequestEpoch } from '../src/api.ts';

test('changing accounts aborts requests and discards a late private response even if a transport ignores abort', async () => {
  const original = globalThis.fetch;
  let resolve, observed;
  globalThis.fetch = async (_url, options) => { observed = options; return new Promise(done => { resolve = done; }); };
  try {
    setCsrfToken('first-user-csrf');
    const pending = request('/api/projects', { method: 'POST', body: '{}' });
    const epoch = sessionRequestEpoch();
    assert.equal(observed.headers.get('X-CSRF-Token'), 'first-user-csrf');
    resetSessionRequests('second-user-csrf');
    assert.equal(observed.signal.aborted, true); assert.ok(sessionRequestEpoch() > epoch);
    resolve(new Response(JSON.stringify({ private: 'first-user-project' }), { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(pending, { name: 'AbortError' });
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.get('X-CSRF-Token'), 'second-user-csrf');
      return new Response(JSON.stringify({ private: 'second-user-project' }));
    };
    assert.deepEqual(await request('/api/projects', { method: 'POST', body: '{}' }), { private: 'second-user-project' });
  } finally { globalThis.fetch = original; resetSessionRequests(); }
});

test('a late unauthorized response from the previous account cannot expire the current account', async () => {
  const original = globalThis.fetch; let resolve;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  try {
    const pending = request('/api/billing/status'); resetSessionRequests('current-account-csrf');
    resolve(new Response(JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Sign in again.' }), { status: 401 }));
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { globalThis.fetch = original; resetSessionRequests(); }
});
